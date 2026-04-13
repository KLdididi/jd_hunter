# 🕷️ JD Hunter

> BOSS直聘职位追踪器 - 自动抓取职位详情

## 功能特性

- 📥 **数据导入** - 支持 CSV/JSON 格式导入职位列表
- 🕷️ **自动爬取** - 通过 CDP 协议自动抓取职位详情页
- 🔍 **多维筛选** - 按城市、经验、关键词过滤
- 📊 **统计分析** - 薪资中位数、城市分布、主流经验要求
- 📤 **一键导出** - 支持 CSV/Excel 格式导出

## 使用方法

### 1. 启动服务

```bash
node edge_proxy.js
```

### 2. 打开 Edge 浏览器

```bash
msedge --remote-debugging-port=9222
```

### 3. 打开页面

在 Edge 中打开 `jd_hunter.html`，或双击 `启动JD Hunter.bat` 一键启动。

### 4. 开始使用

1. 在 BOSS直聘搜索目标职位，导出为 CSV
2. 导入 CSV 文件
3. 点击「开始爬取详情」

## 项目结构

```
jd_hunter/
├── jd_hunter.html     # 主页面
├── edge_proxy.js      # CDP 代理服务
├── 启动JD Hunter.bat  # 一键启动脚本
└── README.md
```

## 技术栈

- 纯前端 HTML/CSS/JavaScript
- CDP (Chrome DevTools Protocol) 浏览器控制
- localStorage 本地存储

## 注意事项

⚠️ 本工具仅供学习研究使用，请遵守网站robots.txt和服务条款。
