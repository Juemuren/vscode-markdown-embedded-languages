# 实现计划

## 第一版

第一版只实现 `fence -> language alias`

```json
{
  "tikz": {
    "language": "latex"
  },

  "jsxgraph": {
    "language": "javascript"
  }
}
```

不自己实现语言服务，而是利用 VSCode 上已有的语言服务或语言服务扩展转发请求。这里主要验证 VSCode 在能力上是否支持我想要的扩展

- 能否真正转发语言服务
- 能否把这个别名映射暴露给使用扩展的用户
- 语言服务扩展是否处理虚拟文档，这里可能存在兼容问题
- 诊断信息能否转发

这是整个扩展最核心的功能。如果实在不行，可能得牺牲部分语言功能。但

- syntax highlighting
- completion
- hover

三个功能尽量不要有所牺牲。

可以参考：

- <https://code.visualstudio.com/api/language-extensions/embedded-languages#request-forwarding>

## 第二版

第二版支持 `virtualDocument.template`

```json
{
  "tikz": {
    "language": "latex",
    "virtualDocument": {
      "template": ".vscode/tikz-template.tex"
    }
  }
}
```

`template` 文件里可以使用 `{{content}}` 作为占位符，这会被替换为 fence code block 中的文本

```tex
% .vscode/tikz-template.tex
\documentclass[tikz]{standalone}
\usepackage{tikz}
\begin{document}
{{content}}
\end{document}
```

## 第三版

第三版实现 `fence -> preview renderer`

```json
{
  "tikz": {
    "language": "latex",
    "virtualDocument": {
      "template": ".vscode/tikz-template.tex"
    },

    "preview": {
      "script": "./preview/tikz.js",
      "style": "./preview/tikz.css"
    }
  }
}
```

## 第四版

第四版支持 `{{attributes.xxx}}` 占位符

```json
{
  "jsxgraph": {
    "language": "javascript",
    "virtualDocument": {
      "template": ".vscode/jsxgraph-template.tex"
    }
  }
}
```

虚拟文档为

```js
#import "@preview/cetz:0.5.2"
#set page(width: {{attributes.width}}, height: {{attributes.height}}, margin: 0pt, fill: none)
#cetz.canvas({
import cetz.draw: *
{{content}}
})
```

使用示例

````md
```cetz {width=300, height=200}
...
```
````
