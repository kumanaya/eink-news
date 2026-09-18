--[[--
E-INK NEWS: reads the newspaper from the E-INK NEWS server.

The page is rendered into page-sized pictures by the server (KOReader has no
HTML engine), and this plugin downloads them and shows them full screen.
--]]

return {
    name = "einknews",
    fullname = _("E-INK NEWS"),
    description = _([[Reads the newspaper from the E-INK NEWS server.

The default address is https://eink-news-nine.vercel.app.
Change it under Tools > E-INK NEWS: server, then open Tools > E-INK NEWS.]]),
    version = "0.1.0",
}
