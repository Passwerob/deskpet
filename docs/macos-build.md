# macOS 构建

项目已包含 `src-tauri/tauri.macos.conf.json`、macOS 菜单栏应用配置和通用架构构建工作流。最低支持 macOS 12，同时兼容 Apple Silicon 与 Intel。

在 GitHub 仓库的 Actions 页面手动运行 `Build Zhuochong for macOS`，即可在 macOS 14 运行器上构建同时支持 Apple Silicon 与 Intel 的 `.app` 和 `.dmg`，产物位于该次运行的 Artifacts。

本机使用 Mac 构建时：

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci
npm run build:macos
```

构建产物位于：

```text
src-tauri/target/universal-apple-darwin/release/bundle/macos/Zhuochong.app
src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg
```

项目使用透明无边框窗口，因此启用了 Tauri 的 `macOSPrivateApi`。这适合通过 `.dmg` 直接分发，但不能提交 Mac App Store。

CI 默认使用 ad-hoc 签名，适合内部测试。正式对外发布时，请在构建环境配置 `APPLE_SIGNING_IDENTITY`，并配置以下任一组公证凭据：

- App Store Connect API：`APPLE_API_ISSUER`、`APPLE_API_KEY`、`APPLE_API_KEY_PATH`
- Apple ID：`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`

向其他用户正式分发前，应配置 Apple Developer 的签名证书和公证凭据；未签名版本只适合内部测试。
