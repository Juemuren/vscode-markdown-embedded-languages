# 实现状态

目前还在实现第一版。

## 已有功能

### language

自定义 Markdown fence 别名到 VS Code 语言 ID 的映射，并且：

- 扩展在代码块内调用已安装语言扩展的补全、悬停，并尝试转发对应的诊断
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

- 补全、悬停的实际效果取决于语言扩展对虚拟文档的支持。如果目标扩展不支持对虚拟文档进行补全或悬停，那么代码块中就无法使用对应的功能
- VS Code 没有通用的诊断请求转发 API。本扩展使用未显示的 `untitled:` 文档接收目标扩展主动发布的诊断；目标扩展不支持该文档类型时，诊断仍不可用

目前已进行兼容性验证的扩展包含

| 语言         | 扩展                                  | 补全 | 悬停 | 诊断 |
| ------------ | ------------------------------------- | ---- | ---- | ---- |
| `javascript` | `vscode.typescript-language-features` | ✅   | ✅   | ❌   |
| `latex`      | `james-yu.latex-workshop`             | ✅   | ❌   | ❌   |

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
