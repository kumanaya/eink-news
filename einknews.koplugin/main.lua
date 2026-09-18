--[[--
E-INK NEWS: plugin entry point.

Registers two entries under KOReader's Tools menu: one opens the newspaper that
the server is printing, the other points the plugin at that server. The address
is remembered in KOReader's settings directory, so it is asked only once.
--]]

local DataStorage = require("datastorage")
local LuaSettings = require("luasettings")
local UIManager = require("ui/uimanager")
local InputDialog = require("ui/widget/inputdialog")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local _ = require("gettext")

local Edition = require("edition")

-- The machine this paper was built against. Change it in
-- Tools > E-INK NEWS: server (it is stored in KOReader's settings).
local DEFAULT_SERVER = "http://192.168.15.25:8080"

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
    return self.settings:readSetting("server") or DEFAULT_SERVER
end

function EinkNews:askServer(after)
    local dialog
    dialog = InputDialog:new{
        title = _("E-INK NEWS: server"),
        description = _("Where the newspaper is being served, for instance http://192.168.1.10:8080"),
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

function EinkNews:openEdition()
    Edition.show{
        server = self:server(),
        on_need_server = function()
            self:askServer()
        end,
    }
end

function EinkNews:addToMainMenu(menu_items)
    menu_items.einknews_open = {
        text = _("E-INK NEWS"),
        sorting_hint = "tools",
        callback = function()
            self:openEdition()
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
