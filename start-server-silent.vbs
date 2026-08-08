Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\stitch_rsb_industrial_labeling_dashboard\backend"
WshShell.Run "node.exe src/server.js", 0, False
