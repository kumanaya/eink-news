--[[--
Fetches the rendered edition from the server, shows it, and keeps watching.

KOReader cannot render HTML, so the newspaper arrives as page images:
`<server>/kindle/edition.json` lists the pages, and they are downloaded into
KOReader's data directory and handed to ImageViewer, which fills the screen
with them.

While the viewer is open the plugin keeps asking the server for edition.json
(a few hundred bytes): when the machine that prints the paper renders a new
edition, the page on screen is replaced by it. That is what makes the Kindle
follow this machine - no closing and reopening the plugin.

The pictures are produced on the server by tools/render-pages.mjs, so the
Kindle never has to render anything but a PNG.
--]]

local DataStorage = require("datastorage")
local Device = require("device")
local InfoMessage = require("ui/widget/infomessage")
local ImageViewer = require("ui/widget/imageviewer")
local RenderImage = require("ui/renderimage")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local lfs = require("libs/libkoreader-lfs")
local ltn12 = require("ltn12")
local socket = require("socket")
local http = require("socket.http")
local socketutil = require("socketutil")
local _ = require("gettext")

-- rapidjson on every recent KOReader; dkjson as the fallback.
local has_rapidjson, JSON = pcall(require, "rapidjson")
if not has_rapidjson then
    JSON = require("json")
end

local Edition = {}

-- How often to ask whether a new edition exists, in seconds. Low enough to
-- feel live, high enough not to keep the Kindle's radio busy.
Edition.watch_seconds = 20

local function editionDir()
    return DataStorage:getDataDir() .. "/einknews"
end

local function fetch(url)
    local sink = {}
    socketutil:set_timeout(socketutil.FILE_BLOCK_TIMEOUT, socketutil.FILE_TOTAL_TIMEOUT)
    local code, _, status = socket.skip(1, http.request{
        url = url,
        -- The server does not compress; being explicit avoids old proxies.
        headers = { ["Accept-Encoding"] = "identity" },
        sink = ltn12.sink.table(sink),
    })
    socketutil:reset_timeout()
    if code ~= 200 then
        return nil, string.format("%s (%s)", tostring(status or code), url)
    end
    return table.concat(sink)
end

local function download(url, dest)
    local handle = io.open(dest, "wb")
    if not handle then
        return false, _("cannot write to the Kindle's data directory")
    end
    socketutil:set_timeout(socketutil.FILE_BLOCK_TIMEOUT, socketutil.FILE_TOTAL_TIMEOUT)
    local code, _, status = socket.skip(1, http.request{
        url = url,
        headers = { ["Accept-Encoding"] = "identity" },
        sink = ltn12.sink.file(handle),
    })
    socketutil:reset_timeout()
    if code ~= 200 then
        os.remove(dest)
        return false, string.format("%s (%s)", tostring(status or code), url)
    end
    return true
end

local function complain(title, server, detail)
    local text = string.format("%s\n\n%s", title, server)
    if detail then
        text = text .. "\n\n" .. detail
    end
    text = text .. "\n\n" .. _("On the machine that prints the paper: npm run serve") ..
        "\n" .. _("(and let the firewall allow that port).")
    logger.warn("einknews:", title, server, detail or "")
    UIManager:show(InfoMessage:new{ text = text, timeout = 10 })
end

local function fetchEdition(server)
    local body, err = fetch(server .. "/kindle/edition.json")
    if not body then
        return nil, err
    end
    local decoded_ok, edition = pcall(JSON.decode, body)
    if not decoded_ok or type(edition) ~= "table" or type(edition.renderings) ~= "table" then
        return nil, _("the server answered, but not with an edition")
    end
    return edition
end

--[[--
Picks the rendering made for this panel.

The server prints the page at every size a Kindle may have (a KT4 is 600x800
in portrait, but the same device in landscape is 800x600), so the plugin asks
for the one that matches the screen it is running on. If the exact size is not
there, the closest one is used and logged - a scaled picture beats no picture.
--]]
local function pickRendering(renderings, width, height)
    local best, best_score
    for _, rendering in ipairs(renderings) do
        if rendering.width == width and rendering.height == height then
            return rendering, "exact"
        end
        local score = math.abs((rendering.width or 0) - width)
            + math.abs((rendering.height or 0) - height)
        if not best_score or score < best_score then
            best, best_score = rendering, score
        end
    end
    return best, best and "closest" or nil
end

-- Prepares the pages of a rendering. An edition can hold a hundred of them and
-- the Kindle's radio is slow, so each page is downloaded when the viewer asks
-- for it; the previous edition's files are dropped first.
local function preparePages(server, rendering)
    local dir = editionDir()
    lfs.mkdir(dir)
    for entry in lfs.dir(dir) do
        if entry:match("%.png$") then
            os.remove(dir .. "/" .. entry)
        end
    end

    local base = string.format("%s/kindle/%dx%d", server, rendering.width, rendering.height)
    local missing = false
    local pages = {}

    for _, page in ipairs(rendering.pages) do
        local dest = dir .. "/" .. page
        -- ImageViewer wants BlitBuffers, or functions returning them: this one
        -- fetches the page (once), then decodes it.
        pages[#pages + 1] = function()
            if not io.open(dest, "rb") then
                local ok, why = download(base .. "/" .. page, dest)
                if not ok then
                    logger.warn("einknews: page failed:", page, why)
                    missing = true
                    -- A checkerboard beats a crash: ImageWidget cannot paint a
                    -- nil image.
                    local screen = Device.screen
                    return RenderImage:renderCheckerboard(screen:getWidth(), screen:getHeight(), screen.bb:getType())
                end
            end
            return RenderImage:renderImageFile(dest)
        end
    end
    return pages, missing and "some pages could not be downloaded" or nil
end

-- Shows the edition full bleed and watches for the next one.
local function openViewer(server, edition, pages, opts)
    local viewer = ImageViewer:new{
        image = pages,
        fullscreen = true,
        with_title_bar = false,
        image_padding = 0,
        buttons_visible = false,
        images_keep_pan_and_zoom = false,
    }
    UIManager:show(viewer)

    local stopped = false

    local function tick()
        if stopped then return end
        local fresh = fetchEdition(server)
        if fresh and fresh.generated ~= edition.generated then
            logger.info("einknews: a new edition is on the wire:", tostring(fresh.generated))
            stopped = true
            UIManager:close(viewer)
            Edition.show{ server = server, quiet = true }
            return
        end
        UIManager:scheduleIn(Edition.watch_seconds, tick)
    end
    UIManager:scheduleIn(Edition.watch_seconds, tick)

    -- Stop asking the server the moment the viewer goes away.
    local inherited_close = viewer.onCloseWidget
    viewer.onCloseWidget = function(self)
        stopped = true
        UIManager:unschedule(tick)
        if inherited_close then
            return inherited_close(self)
        end
    end
end

--[[--
Edition.show{ server = "http://host:port", on_need_server = fn, quiet = bool }

Downloads and opens the edition. Downloading happens in the UI thread, but a
local network makes that a couple of seconds; the socket timeouts keep a dead
server from hanging it forever. `quiet` is for the background refresh that
follows a new edition - it must not flash a message on the screen.
--]]
function Edition.show(opts)
    local server = opts.server
    if not server or server == "" then
        if opts.on_need_server then opts.on_need_server() end
        return
    end

    local message
    if not opts.quiet then
        message = InfoMessage:new{ text = _("Fetching today's edition...") }
        UIManager:show(message)
        UIManager:forceRePaint()
    end

    local function closeMessage()
        if message then
            UIManager:close(message)
            message = nil
        end
    end

    local edition, err = fetchEdition(server)
    if not edition then
        closeMessage()
        if not opts.quiet then
            if err and err:find("404", 1, true) then
                -- The server is up, but nobody has rendered the pages for the
                -- plugin yet (npm run render).
                complain(_("The server has no edition rendered yet."), server, err)
            else
                complain(_("Could not reach the newspaper server."), server, err)
            end
        end
        return
    end

    local screen = Device.screen
    local rendering, how = pickRendering(edition.renderings, screen:getWidth(), screen:getHeight())
    if not rendering then
        closeMessage()
        if not opts.quiet then
            complain(_("The server has no rendered edition yet."), server, nil)
        end
        return
    end
    logger.info(string.format("einknews: panel %dx%d -> rendering %dx%d (%s)",
        screen:getWidth(), screen:getHeight(),
        rendering.width or 0, rendering.height or 0, tostring(how)))

    local pages, why = preparePages(server, rendering)
    if not pages then
        closeMessage()
        if not opts.quiet then
            complain(_("A page failed to download."), server, why)
        end
        return
    end
    closeMessage()

    logger.info("einknews: showing", #pages, "pages from", server)
    openViewer(server, edition, pages, opts)
end

return Edition
