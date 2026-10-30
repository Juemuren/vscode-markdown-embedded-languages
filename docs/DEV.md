# 开发文档

## 接入内置语法文件

内置语法文件在 [builtin/grammars.json](../builtin/grammars.json) 中按 VS Code 语言 ID 登记

- 语法文件支持 JSON 和 plist 格式
- `builtin:` 后的路径相对于 `builtin/` 目录

接入内置语法文件的步骤为：

1. 将 TextMate 格式的语法文件放入 `builtin/`，例如 `builtin/LaTeX.tmLanguage.json`
2. 在 `builtin/grammars.json` 中添加

   ```json
   "latex": {
     "grammar": "builtin:LaTeX.tmLanguage.json"
   }
   ```

3. 如果该语法通过 `include` 引用了其他 scope，在同一条目中添加 `grammars` 映射：键为被引用的 scope，值为对应文件的 `builtin:` 路径

   ```json
   "latex": {
     "grammar": "builtin:LaTeX.tmLanguage.json",
     "grammars": {
       "source.tex": "builtin:TeX.tmLanguage.json"
     }
   }
   ```

4. 保存修改，然后重新编译并加载扩展宿主
