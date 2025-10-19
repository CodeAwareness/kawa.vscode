# Change Log

### 1.0.15

Fixed diff-with-branch functionality.
Compatibility with Kawa Code (new, rebranded version of Code Awareness).

### 1.0.14

Compatibility with Windsurf AI

### 1.0.11

Minor fixes for diff windows and some IPC cleanup for efficiency.

### 1.0.10

Minor fix for IPC communication.

### 1.0.9

Minor fix for IPC communication.

### 1.0.8

Launch of Muninn and Huginn system. You now have a separate application where you can see the context for your work, without having to open the Code Awareness panel in VSCode. You can keep the Code Awareness Muninn application open on one monitor while working with VSCode on another monitor.

- simpler installation, multiple monitor support through a dedicated application window.
- solid foundations for extensibility of Code Awareness; expect a plugin system coming up soon.
- an example extension shows relationships between the code you're looking at (cursor position) and the other parts of the project. This currently only works for Typescript code.

### 1.0.0

First open-source release.

- support for trunk based, single branch development (alpha)
- diff-awareness between you and your team members
- quick diffs between you and your peers, for any file
- list of files changed by your peers is available in the left SCM tree.
- support for branch diffs on the active file
- i18n support for editor language
- theme and color support
