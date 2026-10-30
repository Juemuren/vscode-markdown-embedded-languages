# Markdown Embedded Languages

一个声明式的 Markdown 嵌入语言适配器

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

自定义渲染 MPE 可以实现，但和我想要的声明式接口不一致。我希望的接口类似于

```json
{
  "markdownEmbeddedLanguages.languages": {
    "tikz": {
      "language": "latex",
      "virtualDocument": {
        "template": ".vscode/tikz-template.tex"
      },

      "preview": {
        "script": "./preview/tikz.js",
        "style": "./preview/tikz.css"
      }
    },

    "jsxgraph": {
      "language": "javascript",

      "preview": {
        "script": "./preview/jsxgraph.js"
      }
    }
  }
}
```

扩展本身可以捆绑一些 `virtualDocument` / `preview.script` / `preview.style` 文件，做到开箱即用，但我希望用户仍然可以灵活地自定义。

实现计划参考 [PLAN.md](docs/PLAN.md)。目前的进度参考 [STATUS.md](docs/STATUS.md)。
