--[[--
Probe that exercises the newspaper plugin inside a real KOReader, headless.

Run through the harness, with the paper being served:

    npm run build && npm run render && npm run serve     # in another terminal
    EINKNEWS_DIST=$PWD/dist/kindle \
        sh ../dev-tools/koreader-headless.sh einknews.koplugin \
            tests/koreader-probe.lua

The probe points the plugin at EINKNEWS_SERVER (default http://127.0.0.1:8080)
and walks what a tap does: fetch edition.json, download the pages, hand them to
ImageViewer, fill the screen. Then it checks the two behaviours a user hits
first: a dead server must show a message instead of taking KOReader down, and a
new edition rendered on the server must replace the one on screen by itself
(that is what EINKNEWS_DIST is for: the probe edits the served edition.json).

Each step gets its own event-loop turn on purpose: showing, painting, closing
and reopening are separate turns for a real user, and KOReader's widgets expect
that (closing an ImageViewer in the same turn it was shown trips over a refresh
callback that still needs the frame it has not painted yet).

The first line is injected by the harness so the plugin's modules resolve.
--]]

local DataStorage = require("datastorage")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local lfs = require("libs/libkoreader-lfs")

local PLUGIN_DIR = _KCHAT_PLUGIN_DIR
local RESULT = os.getenv("KCHAT_PROBE_RESULT") or "/tmp/zzprobe.txt"
local SERVER = os.getenv("EINKNEWS_SERVER") or "http://127.0.0.1:8080"
local DEAD_SERVER = "http://127.0.0.1:9" -- discard port: nothing listens there
local DIST = os.getenv("EINKNEWS_DIST")   -- where the served page images live
local expectedSlides = 0                 -- how many slides the next edition has

package.path = PLUGIN_DIR .. "/?.lua;" .. package.path

local fails = 0

local function record(ok, msg)
    logger.info(string.format("ZZPROBE %s %s", ok and "ok" or "FAILED", msg))
    local f = io.open(RESULT, "a")
    if f then
        f:write(string.format("%s %s\n", ok and "ok" or "FAILED", msg))
        f:close()
    end
    if not ok then fails = fails + 1 end
end

local function step(desc, fn)
    local ok, err = pcall(fn)
    record(ok, desc .. (ok and "" or (" -- " .. tostring(err))))
    return ok, err
end

-- KOReader has no isInstanceOf: an ImageViewer is recognised by what it holds.
local function isViewer(widget)
    return widget ~= nil and widget._images_list_nb ~= nil
end

local function topWidget()
    return UIManager:getTopmostVisibleWidget()
end

local function pngCount()
    local dir = DataStorage:getDataDir() .. "/einknews"
    local n = 0
    for entry in lfs.dir(dir) do
        if entry:match("%.png$") then n = n + 1 end
    end
    return n
end

local function readFile(path)
    local f = io.open(path, "rb")
    if not f then return nil end
    local data = f:read("*a")
    f:close()
    return data
end

local function writeFile(path, data)
    local f = io.open(path, "wb")
    if not f then return false end
    f:write(data)
    f:close()
    return true
end

-- How many pages the served edition lists (the plugin downloads them one by
-- one as the viewer asks, so the count on disk is not the count on the board).
local function slidesOnServer()
    local json = readFile(DIST .. "/edition.json") or ""
    local n = 0
    for _ in json:gmatch('"page%-%d+%.png"') do n = n + 1 end
    for _ in json:gmatch('"pages%.png"') do n = n + 1 end
    return n
end

-- Pretends the server has just printed an extra slide: the probe is what keeps
-- it honest, since only a real refresh proves the watching works. Every panel
-- profile gets the extra page, so whichever one this screen picks has something
-- new to show.
local function publishNewEdition()
    local json = readFile(DIST .. "/edition.json")
    assert(json, "no edition.json at " .. DIST)

    for entry in lfs.dir(DIST) do
        local profile = DIST .. "/" .. entry
        local png = readFile(profile .. "/page-00.png")
        if png then
            writeFile(profile .. "/page-99.png", png) -- stand-in for the new slide
        end
    end

    json = json:gsub('"generated"%s*:%s*"[^"]*"', '"generated": "2099-01-01T00:00:00.000Z"')
    json = json:gsub('("pages"%s*:%s*%[)', '%1\n        "page-99.png",')
    writeFile(DIST .. "/edition.json", json)

    local n = 0
    for _ in json:gmatch('"page%-%d+%.png"') do n = n + 1 end
    for _ in json:gmatch('"pages%.png"') do n = n + 1 end
    return n
end

-- --- turn 1: fetch, download, show -------------------------------------------

UIManager:scheduleIn(3, function()
    local Edition
    if not step("require the plugin's edition module", function()
        Edition = require("edition")
        assert(type(Edition.show) == "function", "no show() in edition")
    end) then
        logger.info("ZZPROBE DONE fails=" .. tostring(fails))
        return
    end

    if not step("download and show the edition from " .. SERVER, function()
        Edition.show{ server = SERVER }
    end) then
        logger.info("ZZPROBE DONE fails=" .. tostring(fails))
        return
    end

    local fetched = pngCount()
    record(fetched > 0 and fetched < slidesOnServer(),
        string.format("the first pages came on demand (%d of %d on disk)", fetched, slidesOnServer()))

    local viewer = topWidget()
    record(isViewer(viewer), "ImageViewer is on screen")
    if isViewer(viewer) then
        record(viewer._images_list_nb == slidesOnServer(),
            string.format("the viewer got every page (%s of %d)",
                tostring(viewer._images_list_nb), slidesOnServer()))
        record(viewer.fullscreen == true and viewer.image_padding == 0,
            "the viewer fills the screen (fullscreen, no padding)")
    end
end)

-- --- turn 2: close it, the way a tap on the middle does -----------------------

UIManager:scheduleIn(7, function()
    local viewer = topWidget()
    if isViewer(viewer) then
        step("close the viewer", function()
            UIManager:close(viewer)
        end)
    else
        record(false, "the viewer was gone before it could be closed")
    end
end)

-- --- turn 3: the unhappy path, nothing is listening ---------------------------

UIManager:scheduleIn(10, function()
    local Edition = require("edition")

    step("a dead server shows a message instead of crashing", function()
        Edition.show{ server = DEAD_SERVER }
    end)

    local message = topWidget()
    record(message ~= nil and not isViewer(message),
        "no viewer was opened for the dead server")
    if message then
        step("close whatever was shown", function()
            UIManager:close(message)
        end)
    end
end)

-- --- turn 4: a new edition appears on the server ------------------------------

UIManager:scheduleIn(13, function()
    local Edition = require("edition")
    Edition.watch_seconds = 2 -- do not wait 20s in a test

    if not DIST then
        record(false, "EINKNEWS_DIST not set: cannot test the live refresh")
        logger.info("ZZPROBE DONE fails=" .. tostring(fails))
        return
    end

    if not step("open the edition again, then print a new one on the server", function()
        Edition.show{ server = SERVER }
        assert(isViewer(topWidget()), "the viewer did not open")
        expectedSlides = publishNewEdition()
        assert(expectedSlides > 0, "the probe could not count the new edition")
    end) then
        logger.info("ZZPROBE DONE fails=" .. tostring(fails))
        return
    end
end)

-- --- turn 5: the viewer must have been replaced by itself ---------------------

UIManager:scheduleIn(22, function()
    local viewer = topWidget()
    record(isViewer(viewer), "a viewer is still on screen after the new edition")
    if isViewer(viewer) then
        -- The extra slide the probe published must be in the list now: the
        -- count coming from the server is the proof that it re-downloaded.
        record(expectedSlides > 0 and viewer._images_list_nb == expectedSlides,
            string.format("the new edition replaced it (%s slides)", tostring(viewer._images_list_nb)))
        step("close the viewer", function()
            UIManager:close(viewer)
        end)
    end

    logger.info("ZZPROBE DONE fails=" .. tostring(fails))
end)
