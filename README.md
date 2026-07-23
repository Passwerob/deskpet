# Zhuochong

一个独立运行的桌面宠物应用。当前版本包含三只小狗皮肤、透明桌宠窗口、139 帧翻滚动画、亲密度/饱腹/精力互动、闹钟管理、系统通知、托盘驻留和开机启动。

## 技术栈

- Tauri 2
- React 19
- TypeScript
- Rust
- Vite

## 开发

```powershell
npm install
npm run tauri dev
```

只预览前端界面：

```powershell
npm run dev
```

桌宠窗口浏览器预览地址：

```text
http://127.0.0.1:1420/?window=pet
```

## 构建

```powershell
npm run tauri build
```

Windows 构建需要 Rust MSVC、Microsoft C++ Build Tools 和 WebView2 Runtime。

macOS 通用架构 `.app`/`.dmg` 的构建方式见 [`docs/macos-build.md`](docs/macos-build.md)。

在 macOS 12 及以上系统可直接执行：

```bash
npm run build:macos
```

## 互动

- 单击小狗：摸摸并挥手
- 双击小狗：打开设置
- 连续点击三次：触发完整翻滚
- 左右拖动：按拖动方向奔跑
- 悬停片刻：小狗会观察你并进入思考动作
- 设置页可喂食、玩耍和休息，状态会本地保存

## 动画

动画使用 `requestAnimationFrame` 和单 Canvas 原子绘制。每套皮肤的翻滚动作由 24 个独立设计的关键姿势经双遮罩 RIFE 插帧为 139 个唯一帧，完整动作时长 4.8 秒。
