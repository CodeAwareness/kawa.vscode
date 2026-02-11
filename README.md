# Kawa Code

Universal Context Platform.

Kawa Codes provides context for your work, in any application that supports a plugin, add-on, or extension system. With Kawa Code you can be aware of different levels of context, such as people working on your project, relationships between different parts, documents and chat messages relevant to the specific part you have on the screen, and more.

More information on our [website](https://codeawareness.com).

## Features

- File diffs awareness between you and your team members, by means of color highlights in your code
- Quick diffs between you and your peers, for any file. Just click on a team member to see the differences between their and your local version.
- List of files changed by your peers is available in the SCM tree (left panel, under Explorer, Outline, Timeline).
- Support for quick branch diffs on the active file. Click on any branch to see the code diffs between that branch and your current file content.
- Swarm Authorization: you don't need to give us read access to your code base. Only file diffs are passing through our servers. More details on our [website](https://codeawareness.com/swarm-authentication).

## Requirements

1. Download and install the [Kawa Code Muninn](https://codeawareness.com/) application. This is the application that shows you contextual information for the work you're doing in other applications.

## Release Notes

Kawa Code allows you to see your peer's changes (diffs). When editing a file, you will see navy blue code highlights and also blue markers next to the scrollbar (the gutter indicators). These are the lines of code where other people have made changes to the file, locally in their own branch, or perhaps in the same branch. This is especially useful for a form of Trunk Based Development. When you open the Kawa Code, you'll be able to see the people who have made those changes. Click on their portrait to see the diffs between you and them. You can also click on any local branch (shown in the panel) to see the diffs between your file and the same file in that branch.

In addition, by configuring your Claude Code API key, you can take advantage of our new Intent-driven development (beta), which is a new way to record decisions made during AI-assisted development.

### 4.0.0

Works with the new Kawa Code application.
Intent-first development.
Code translation feature 

### 1.0.7

Launch of Muninn and Huginn system. You now have a separate application where you can see the context for your work, without having to open the Kawa Code panel in VSCode. You can keep the Kawa Code Muninn application open on one monitor while working with VSCode on another monitor.

- simpler installation
- solid foundations for extensibility of Kawa Code; expect a plugin system coming up soon.

### 1.0.0

First open-source release.

- support for trunk based, single branch development (alpha)
- diff-awareness between you and your team members
- quick diffs between you and your peers, for any file
- list of files changed by your peers is available in the left SCM tree.
- support for branch diffs on the active file
- i18n support for editor language
- theme and color support

-----------------------------------------------------------------------------------------------------------

# Development

## Setup

- Run your Kawa Code panel with `yarn dev`
- Launch the Kawa Code Muninn application
- Finally go to VSCode, open this extension source code folder, change `const DEBUG = true` in the `src/config` file, and choose Run Extension.

## Setup git to work with unicode in your filenames

`git config core.quotepath off`

After which a `git ls-files` will list the files with the approriate characters.
