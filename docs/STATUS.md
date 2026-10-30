# 实现状态

目前还在实现第一版。

## 已有功能

目前实现了 Markdown fence 别名到 VS Code 语言 ID 的映射：

- 扩展在代码块内调用已安装语言扩展的补全和悬停提供器
- 如果目标扩展为虚拟文档发布诊断，也会把诊断显示在 Markdown 中

在 VS Code 的工作区设置中加入如下设置

```json
{
  "markdownEmbeddedLanguages.languages": {
    "tikz": { "language": "latex" },
    "jsxgraph": { "language": "javascript" }
  }
}
```

保存设置后会自动更新映射。其中 `language` 必须是 VS Code 语言 ID，并且需要安装相应的语言扩展。

fence 由 markdown-it 按 CommonMark 规则识别。

## 当前限制

- VS Code 没有将任意 TextMate 语法高亮动态应用到 Markdown 局部区域的公开 API，因此此版的可配置别名不保证语法高亮。
- 现有语言扩展也可能只处理文件文档，而不处理本扩展的虚拟文档。
- VS Code 没有通用的诊断请求转发 API，因此诊断只在目标扩展主动为虚拟文档发布诊断时可用。
- 补全、悬停的实际效果取决于目标扩展对虚拟文档的支持；本版尚未在真实扩展组合中完成兼容性验证。
