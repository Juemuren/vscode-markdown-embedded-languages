# 开发文档

## 接入内置语法文件

内置语法文件在 [builtin/grammars.json](../builtin/grammars.json) 中登记

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

## 语言扩展兼容性检测任务

语言扩展兼容性检测任务的配置在 [compat/configs](../compat/configs) 中，脚本在 [compat/scripts](../compat/scripts) 中。

语言扩展兼容性检测任务运行时会启动独立的 VS Code 扩展宿主，结束后在终端中汇总结果

- `forwarded` 表示普通文件与 Markdown 都返回了该能力
- `missing` 表示普通文件有结果而 Markdown 没有
- `not exercised` 表示普通文件本身没有产生可对照的结果

结果也同时保存在 `.tmp/compat/<运行编号>/result.json` 中。

兼容性检测的内容包含

- 补全兼容性
- 悬停兼容性
- 诊断兼容性
- 语义高亮兼容性

运行检测任务的方式有

- 运行 VS Code 任务 **Probe language compatibility**。这种方式只能启动默认的用例
- 在项目根目录运行 `npm run test:compat`。可以添加参数启动任意的用例 `npm run test:compat -- example`

运行检测任务的要求为

- 本机已安装 VS Code 且 `code` 在 PATH 中
- 可用 `VSCODE_CLI` 环境变量设置 VS Code 可执行文件的路径；Windows 上应指向 `Code.exe`

默认用例为 `javascript`，配置保存在 [compat/configs/javascript.json](../compat/configs/javascript.json) 中。要添加其它语言扩展的用例，可复制其内容到 `compat/configs/example.json` 文件中，然后参照以下说明修改配置

- `language`：VS Code 语言 ID
- `alias`：Markdown fence 名称
- `extension`：基线文件扩展名
- `source`：同时写入普通代码文件和 Markdown fence 的测试代码。应包含可触发补全、悬停及诊断的位置
- `completion` / `hover`：相对于 `source` 从 `0` 开始的行号与列号
- `extensionId`：（可选）在报告中显示是否安装并激活指定的语言扩展。VS Code 根据识别到的语言和用户配置选择扩展；该配置项不改变 VS Code 实际使用的语言扩展，报告结果中也不包含 VS Code 实际使用的语言扩展——VS Code 目前未提供这些接口

用 `npm run test:compat -- example` 运行新用例。
