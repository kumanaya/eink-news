--[[--
E-INK NEWS: plugin entry point.

Registers the paper under KOReader's Tools menu in two modes: a reader you
turn by hand, and a board that turns itself like the site and the scriptlet.
A third entry points the plugin at the server. The address is remembered in
KOReader's settings directory, so it is asked only once.
--]]

local DataStorage = require("datastorage")
local LuaSettings = require("luasettings")
local UIManager = require("ui/uimanager")
local InputDialog = require("ui/widget/inputdialog")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local _ = require("gettext")

local Edition = require("edition")

-- The paper on Vercel. Change it in Tools > E-INK NEWS: server
-- (it is stored in KOReader's settings).
local DEFAULT_SERVER = "https://eink-news-nine.vercel.app"
local LEGACY_SERVERS = {
    ["http://192.168.15.25:8080"] = true,
    ["http://127.0.0.1:8080"] = true,
    ["http://localhost:8080"] = true,
}

local SETTINGS_FILE = DataStorage:getSettingsDir() .. "/einknews.lua"

local EinkNews = WidgetContainer:extend{
    name = "einknews",
    is_doc_only = false,
}

function EinkNews:init()
    self.settings = LuaSettings:open(SETTINGS_FILE)
    self.ui.menu:registerToMainMenu(self)
end

function EinkNews:server()
    local saved = self.settings:readSetting("server")
    if saved and saved ~= "" then
        saved = saved:gsub("/+$", "")
        if not LEGACY_SERVERS[saved] then
            return saved
        end
    end
    return DEFAULT_SERVER
end

function EinkNews:askServer(after)
    local dialog
    dialog = InputDialog:new{
        title = _("E-INK NEWS: server"),
        description = _("Where the newspaper is being served, for instance https://eink-news-nine.vercel.app"),
        input = self:server(),
        buttons = {
            {
                {
                    text = _("Cancel"),
                    id = "close",
                    callback = function()
                        UIManager:close(dialog)
                    end,
                },
                {
                    text = _("Save"),
                    is_enter_default = true,
                    callback = function()
                        local url = dialog:getInputText()
                        UIManager:close(dialog)
                        if url and url ~= "" then
                            -- No trailing slash: the plugin appends paths.
                            self.settings:saveSetting("server", url:gsub("/+$", ""))
                            self.settings:flush()
                            if after then after() end
                        end
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function EinkNews:openEdition(auto)
    Edition.show{
        server = self:server(),
        auto = auto and true or false,
        on_need_server = function()
            self:askServer()
        end,
    }
end

function EinkNews:addToMainMenu(menu_items)
    menu_items.einknews_reader = {
        text = _("E-INK NEWS: reader"),
        sorting_hint = "tools",
        callback = function()
            self:openEdition(false)
        end,
    }
    menu_items.einknews_board = {
        text = _("E-INK NEWS: board"),
        sorting_hint = "tools",
        callback = function()
            self:openEdition(true)
        end,
    }
    menu_items.einknews_server = {
        text = _("E-INK NEWS: server"),
        sorting_hint = "tools",
        callback = function()
            self:askServer()
        end,
    }
end

return EinkNews
