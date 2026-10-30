# 实现状态

目前还在实现第一版。

## 已有功能

### language

自定义 Markdown fence 别名到 VS Code 语言 ID 的映射，并且：

- 扩展在代码块内调用已安装语言扩展的补全、悬停，并转发对应的诊断
- 使用扩展内置的语法文件对代码块进行语法高亮。该文件可被覆盖（见 [highlight](#highlight)）

#### language 设置示例

```json
{
  "markdownEmbeddedLanguages.languages": {
    "tikz": { "language": "latex" },
    "jsxgraph": { "language": "javascript" }
  }
}
```

其中 `language` 必须是 VS Code 语言 ID。

#### language 当前限制

- 现有语言扩展可能只处理文件文档，而不处理本扩展的虚拟文档
- 补全、悬停的实际效果取决于目标扩展对虚拟文档的支持
- VS Code 没有通用的诊断请求转发 API，因此诊断只在目标扩展主动为虚拟文档发布诊断时可用
- 本扩展尚未在真实扩展组合中完成兼容性验证

### highlight

自定义 Markdown fence code block 的语法高亮，并且：

- 指定语法文件后，高亮通过 VS Code 的语义高亮功能实现，颜色由当前主题决定
- 若主题关闭语义高亮，需在设置中启用 `editor.semanticHighlighting.enabled`

#### highlight 设置示例

```json
{
  "markdownEmbeddedLanguages.languages": {
    "jsxgraph": {
      "language": "javascript",
      "highlight": {
        "grammar": "path/to/javascript.tmLanguage.json"
      }
    }
  }
}
```

其中 `highlight.grammar` 指向工作区根目录下的 JSON 或 plist TextMate 文件，也可以使用绝对路径。

如果语法文件通过 `include` 引用其他语法 scope，可以用 `highlight.grammars` 提供额外映射

```json
{
  "highlight": {
    "grammar": "path/to/javascript.tmLanguage.json",
    "grammars": {
      "source.other": "path/to/other.tmLanguage.json"
    }
  }
}
```

找不到的 scope 会写入 **Markdown Embedded Languages** 输出通道。

#### highlight 当前限制

- 语法文件修改后需要重新加载窗口
