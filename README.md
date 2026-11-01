# Markdown Embedded Languages

一个声明式的 Markdown 嵌入语言适配器。

## 功能

功能一：语言服务转发

```txt
Markdown fence
    ↓
Embedded Language Adapter
    ↓
existing VSCode language extension
```

功能二：自定义渲染

```txt
Markdown fence
    ↓
Renderer Adapter
    ↓
existing VSCode markdown preview
```

## 设置示例

```json
{
  "markdownEmbeddedLanguages.languages": {
    "tikz": {
      "language": "latex",
      "virtualDocument": {
        "template": "./templates/tikz-template.tex"
      },
      "preview": {
        "script": "./previews/tikz.js",
        "style": "./previews/tikz.css"
      }
    },

    "jsxgraph": {
      "language": "javascript",
      "preview": {
        "script": "./previews/jsxgraph.js"
      },
      "highlight": {
        "grammar": "./grammars/javascript.tmLanguage.json"
      }
    }
  }
}
```

扩展为了开箱即用，会提供默认设置并捆绑一些文件；但用户可以覆盖默认设置，以及添加任意的新语言适配。

## 文档

- 实现计划 [PLAN.md](docs/PLAN.md)
- 当前进度 [STATUS.md](docs/STATUS.md)
- 开发文档 [DEV.md](docs/DEV.md)
