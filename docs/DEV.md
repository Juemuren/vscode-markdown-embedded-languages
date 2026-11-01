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

语言扩展兼容性检测任务会启动独立的 VS Code 扩展宿主，结束后在终端中汇总结果

- `forwarded` 表示普通文件和 Markdown 中的结果相同
- `partial` 表示普通文件和 Markdown 都有结果但不完全相同
- `missing` 表示普通文件有结果而 Markdown 没有对应结果
- `not exercised` 表示普通文件本身没有产生可对照的结果

结果也同时保存在 `.tmp/compat/<运行编号>/result.json` 中。

兼容性检测的内容包含

- 补全兼容性
- 悬停兼容性
- 诊断兼容性

### 运行语言扩展兼容性检测任务

运行检测任务的方式有

- 运行 VS Code 任务 **Probe language compatibility**。这种方式只能启动默认的用例
- 在项目根目录运行 `npm run test:compat`。可以添加参数启动任意的用例 `npm run test:compat -- example`

运行检测任务的要求为

- 本机已安装 VS Code 且 `code` 在 PATH 中
- 可用 `VSCODE_CLI` 环境变量设置 VS Code 命令行入口的路径；Windows 上应指向 `code.cmd`

### 配置语言扩展兼容性检测任务

配置分为全局环境配置和单次检测的配置。

全局环境配置位于 `compat/envs/` 目录，包含

- 全局用户设置，位于 [compat/envs/settings.json](../compat/envs/settings.json)。每次检测运行前会被复制到 `.tmp/compat/<运行编号>/user-data/User/settings.json` 中。工作区设置由脚本根据单次测试的配置写入
- 扩展 VSIX 文件，位于 [compat/envs/extensions/](../compat/envs/extensions/) 下。如果单次检测的配置在 `extension.vsix` 中填写了文件名，那么脚本会去 `compat/envs/extensions/` 目录下寻找对应的 VSIX 文件并安装扩展。检测环境的扩展安装目录位于 `.tmp/compat/<运行编号>/extensions`，不影响日常的 VS Code 扩展目录

单次检测的配置位于 `compat/configs/<用例名>/` 目录，其中 `config.json` 是单次检测的配置文件，包含

- `fence`：Markdown fence 名称
- `language`：VS Code 语言 ID
- `source`：相对于配置目录的源码文件路径。源码文件内容会被写入测试工作区的 `baseline.*` 中，文件内容应包含可触发补全、悬停及诊断的位置
- `template`：相对于配置目录的 Markdown 模板路径。模板中的 `{{fence}}` 会替换为 `fence` 的值，`{{source}}` 会替换为 `source` 文件中的内容。模板文件中必须包含一个 `{{source}}` 和至少一个 `{{fence}}`。生成的文件位于测试工作区的 `sample.md`
- `completion` / `hover`：相对于 `source` 文件内容从 `1` 开始的行号与列号，用于指定在什么位置触发补全和悬停。Markdown 文件中的补全和悬停位置会根据 `{{source}}` 的插入位置自动计算，不需要手工调整
- `extension.id`：在报告中显示是否安装并激活指定的语言扩展。若填写了 `extension.vsix`，则 `extension.id` 还用于在隔离目录中定位并加载指定的扩展。由于 VS Code 根据识别到的语言和用户配置选择扩展，因此该配置项不一定能够改变 VS Code 实际使用的语言扩展，报告结果中也无法确定 VS Code 实际使用的语言扩展
- `extension.vsix`：（可选）放在 `compat/envs/extensions/` 下的 VSIX 文件名。运行前会安装到本次检测的隔离扩展目录；安装失败则停止检测。内置扩展的检测无需填写此项

默认用例为 `javascript`，配置、源码及模板保存在 [compat/configs/javascript/](../compat/configs/javascript/) 中。要添加其它语言扩展的用例，可复制该目录到 `compat/configs/example/`，然后参照上述说明修改配置、源码与模板，最后用 `npm run test:compat -- example` 运行新用例。
