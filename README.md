# ![](resources/terminal.png) Terminal Manager

Terminal Manager is a visual studio code extension to switch between various terminals.

[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=saurabh.terminal-manager)

[![Install extension button](https://res.cloudinary.com/saurabhdaware/image/upload/v1564401766/saurabhdaware.in/otherAssets/iebutton.png)](https://marketplace.visualstudio.com/items?itemName=saurabh.terminal-manager)

## Features

By default vscode lets us define only one link of terminal from settings.

Using this extension you can provide an array of terminals (optionally nested in groups) and then you can switch between them from a new Terminal icon in activity bar.

- Click a terminal in the sidebar to open it
- Group terminals in a nested tree
- Add, edit, delete, and move items from the UI — no JSON required
- Config is stored per project at `.vscode/terminals.json`
- JSON editing is still available for bulk changes

![](screenshots/ss1.png)
![](screenshots/ss2.png)

## Manage terminals from the UI

Open the **Terminal Manager** view in the activity bar:

| Action | Where |
| --- | --- |
| Add Terminal | `+` in the view title, or on a group |
| Add Group | New folder icon in the view title, or on a group |
| Edit | Hover an item and click the pencil, or right-click → Edit |
| Delete | Hover an item and click the trash, or right-click → Delete |
| Move | Right-click → Move to Group |
| Edit JSON | JSON icon in the view title |

Clicking a group’s `+` adds the new terminal (or nested group) inside that group.

Add, edit, move, and delete all open an **editor tab** with every field on one form (name, shell, arguments, working directory, group). Save writes `.vscode/terminals.json`.

## Extension Settings

Config lives in the current project: **`.vscode/terminals.json`**.

Click the JSON icon in the Terminal Manager activity bar to edit it directly. The file is created automatically when you add the first terminal or group.

Old flat arrays still work and are migrated on first load. Groups use `"type": "group"` and a `children` array.

### In Windows :
```json
[
    {
        "type": "group",
        "label": "Windows",
        "children": [
            {
                "type": "terminal",
                "label": "CMD",
                "shellPath": "C://Windows//System32//cmd.exe",
                "shellArgs": ["/K", "echo Heya!"]
            },
            {
                "type": "terminal",
                "label": "PowerShell",
                "shellPath": "C://Windows//System32//WindowsPowerShell//v1.0//powershell.exe"
            }
        ]
    },
    {
        "type": "group",
        "label": "Linux",
        "children": [
            {
                "type": "terminal",
                "label": "Ubuntu",
                "shellPath": "C://Windows//System32//bash.exe"
            }
        ]
    }
]
```

### In Linux and OSX:
```json
[
    {
        "type": "group",
        "label": "Shells",
        "children": [
            {
                "type": "terminal",
                "label": "Login bash",
                "shellPath": "/bin/bash",
                "shellArgs": ["-l"]
            },
            {
                "type": "terminal",
                "label": "sh",
                "shellPath": "/bin/sh"
            }
        ]
    }
]
```

## Contribution

- Check for the issues on https://github.com/saurabhdaware/vscode-terminal-manager/issues
- Fork the project
- Finish your changes and make Pull Request to Master branch of https://github.com/saurabhdaware/vscode-terminal-manager

## Local Development

- Fork this project
- `git clone https://github.com/{your username}/vscode-terminal-manager`
- `cd vscode-terminal-manager`
- `npm install`
- Open the project in Visual Studio Code and press `Ctrl + f5` to start Extension host.

## Release Notes

### 1.1.0

- Nested tree groups for terminals
- Add, edit, delete, and move terminals/groups from the sidebar UI
- Config stored in the project at `.vscode/terminals.json`
- Existing flat `terminals.json` files are migrated automatically

### 1.0.0 - 1.0.4

- Initial Release of Terminal Manager and Minor Updates.

### 1.0.5

- Fixed Path error that was thrown in Ubuntu when edit button was clicked

### 1.0.6

- shellArgs can be added to terminal (Thanks to [#PR5](https://github.com/saurabhdaware/vscode-terminal-manager/pull/5) by [4a-42](https://github.com/4a-42))
- added default terminals.json configs for linux and osx


----

***Dont forget to star my github repository https://github.com/saurabhdaware/vscode-terminal-manager***

***Enjoy 🎉***
