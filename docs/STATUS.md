# 实现状态

目前还在实现第一版。

## 已有功能

目前实现了 Markdown fence 别名到 VS Code 语言 ID 的映射：

- 扩展在代码块内调用已安装语言扩展的补全和悬停提供器
- 如果目标扩展为虚拟文档发布诊断，也会把诊断显示在 Markdown 中
- 可为别名指定 TextMate 语法文件，解析词法 token 后通过语义高亮显示在 Markdown 编辑器中

在 VS Code 的工作区设置中加入如下设置

```json
{
  "markdownEmbeddedLanguages.languages": {
    "tikz": { "language": "latex" },
    "jsxgraph": {
      "language": "javascript",
      "highlight": {
        "grammar": "path/to/javascript.tmLanguage.json"
      }
    }
  }
}
```

保存设置后会自动更新映射。其中：

### language

`language` 必须是 VS Code 语言 ID，并且需要安装相应的语言扩展。

#### language 当前限制

- 现有语言扩展也可能只处理文件文档，而不处理本扩展的虚拟文档。
- VS Code 没有通用的诊断请求转发 API，因此诊断只在目标扩展主动为虚拟文档发布诊断时可用。
- 补全、悬停的实际效果取决于目标扩展对虚拟文档的支持；本版尚未在真实扩展组合中完成兼容性验证。

### highlight

`highlight.grammar` 指向工作区根目录下的 JSON 或 plist TextMate 文件，也支持使用绝对路径。

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

指定语法文件后，高亮会将常见 TextMate scope 映射为 VS Code 标准语义 token 类型，颜色由当前主题决定。

#### highlight 当前限制

- 若主题关闭语义高亮，需在设置中启用 `editor.semanticHighlighting.enabled`
- 语法文件修改后需要重新加载窗口
