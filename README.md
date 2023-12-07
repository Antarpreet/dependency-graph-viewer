# Dependency Graph Extension (Alpha) for Visual Studio Code

This extension provides a visual representation of the dependency graph of your projects in Visual Studio Code.

**Supported Languages**: Javascript(.js/.jsx), Typescript(.ts/.tsx), Python(.py)

## Features

* **Dependency Graph**: Visualize the dependencies between your Javascript/Typescript files and classes in a D3 graph.
* **Interactive Graph**: Click on a node to open the corresponding file or class in a new editor (if path identified).
* **Support for Various Node Types**: Supports classes, files, and other Javascript/Typescript constructs.
* **Git status visualization**: See the git status of files in the graph (See legend in the graph for more info).

## How To Use

Right-click on any file in the vscode explorer of supported language type and choose `View Dependency Graph` option.

## Upcoming features

- Make graph more interactive by providing detailed info about the node based on the type of entity (class, function, file, property etc.)
- Add right-click option for directories to display file-level dependency graph
- Add support for other languages

**Enjoy!**
