# Colab Sync

**Run on Colab. Work locally. Stay synchronized.**

Colab Sync is a Visual Studio Code extension that keeps a local project folder in sync with the files used by a Google Colab notebook runtime. It supports Python and R notebooks, allowing you to work with your project in VS Code while using Colab for notebook execution.

## Features

- Two-way synchronization between a local workspace and Google Colab
- Python and R Colab kernel support
- Automatic project-folder mapping to `/content/<project-name>`
- Synchronization of nested directories and empty folders
- Detection of local and remote file changes
- Manual push, pull, and sync commands
- Conflict handling for files changed on both sides
- Configurable polling interval and transfer concurrency

## Requirements

Install the following Visual Studio Code extensions:

- [Jupyter](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)
- [Google Colab](https://marketplace.visualstudio.com/items?itemName=google.colab)

You will also need to sign in to Google Colab through the Google Colab extension.

## Getting started

1. Open your project folder in VS Code.
2. Open the `.ipynb` notebook you want to use.
3. Select a Google Colab kernel from the notebook kernel picker.
4. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
5. Run **Colab Sync: Connect** and follow the prompts.

On the first connection, Colab Sync initializes the remote project folder using your local project folder name. For example, a local folder named `MyProject` is mapped to `/content/MyProject` in Colab.

## Commands

| Command | Description |
| --- | --- |
| **Colab Sync: Connect** | Connect to the selected Colab notebook kernel. |
| **Colab Sync: Disconnect** | Stop synchronization. Local files are kept. |
| **Colab Sync: Sync Now** | Start an immediate synchronization. |
| **Colab Sync: Push Local Changes** | Send local changes to Colab. |
| **Colab Sync: Pull Remote Changes** | Retrieve remote changes from Colab. |
| **Colab Sync: Initialize Project** | Initialize the project and its remote folder mapping. |
| **Colab Sync: Resolve Conflicts** | Review detected file conflicts. |
| **Colab Sync: Show Status** | View the current connection and sync status. |
| **Colab Sync: Reconnect Runtime** | Reconnect to the selected notebook runtime. |

## Configuration

The following settings are available in VS Code:

| Setting | Default | Description |
| --- | ---: | --- |
| `colabsync.autoSync` | `true` | Default auto-sync behavior for new project configurations. |
| `colabsync.pollInterval` | `10` | Remote polling interval in seconds. Set to `0` to disable polling. |
| `colabsync.transferConcurrency` | `3` | Number of concurrent file transfers. |
| `colabsync.maxFileSize` | `524288000` | Maximum file size in bytes (500 MiB). |
| `colabsync.logLevel` | `info` | Output verbosity: `error`, `warn`, `info`, or `debug`. |

## Troubleshooting

### No active notebook kernel is available

- Make sure the notebook is open in VS Code.
- Select a Google Colab kernel in the notebook toolbar.
- Confirm that the Google Colab extension is signed in.
- Check **Jupyter: Manage Access to Jupyter Kernels** and grant access to Colab Sync.
- Run **Colab Sync: Connect** again.

### Remote changes are not appearing immediately

Colab Sync checks for remote changes at the configured polling interval. You can also run **Colab Sync: Sync Now** to start a synchronization manually.

## Creator

**Sujit Kumar**

- Creator Profile: [sujitkm.github.io](https://sujitkm.github.io/)

## License

This project is licensed under the Apache License 2.0. See [LICENSE.txt](LICENSE.txt).
