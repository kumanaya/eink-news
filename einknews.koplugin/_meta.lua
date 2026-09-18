--[[--
E-INK NEWS: reads the newspaper that is being served on your own network.

The page is rendered into page-sized pictures by the server (KOReader has no
HTML engine), and this plugin downloads them and shows them full screen.
--]]

return {
    name = "einknews",
    fullname = _("E-INK NEWS"),
    description = _([[Reads the newspaper served on your own network.

Add the server under Tools > E-INK NEWS: server, for instance
http://192.168.1.10:8080, then open Tools > E-INK NEWS.]]),
    version = "0.1.0",
}
