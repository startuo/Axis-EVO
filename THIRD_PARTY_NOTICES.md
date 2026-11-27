# Third-party notices

The Edge extraction compatibility layer includes `content.js` (adapted) and
`redact.js` (unchanged) from [alchaincyf/huashu-chrome](https://github.com/alchaincyf/huashu-chrome)
1.3.0 at commit `84d5ee40532ca586650d3d5f78f3952d3061cd06`, Copyright (c) 2026
花叔 (alchaincyf), under the MIT License. The complete upstream notice is retained
in [browser/edge-extension/vendor/LICENSE](browser/edge-extension/vendor/LICENSE).
The command restrictions, removed field values and disabled retries are described
in [the adaptation notes](browser/edge-extension/vendor/README.md).
The original MCP server and unrestricted browser transport are not included.

The unchanged `third_party/awesome_copilot/meeting_minutes/SKILL.md` is from
GitHub's [awesome-copilot](https://github.com/github/awesome-copilot) at commit
`0fe6545b950671641b2b14b44eb56678fea6c6b4`, original path
`skills/meeting-minutes/SKILL.md`, under the MIT License, Copyright GitHub, Inc.
The full original copyright and permission notice is redistributed in that
directory's `LICENSE`; `SOURCE.json` pins the Git blob and SHA-256 identities.
Axis-Evo's text-only SkillCard adaptation is a separately identified executable
representation and does not implement the full upstream workflow or a general
SKILL.md runtime. No upstream scripts or external integration commands are run.

The theme stylesheet and motion constants are adapted from
[Caho1/open-claude-ui](https://github.com/Caho1/open-claude-ui) at commit
`2834bc158a4849f21c97cbb2e0b10525f6e646f1`.

MIT License

Copyright (c) 2026 Caho1

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Inter, Newsreader and JetBrains Mono are self-hosted under the SIL Open Font
License 1.1. Their license files accompany the fonts in `web/public/fonts/`.
The application makes no font or asset requests to a CDN at runtime.

The retained workbench palette contains selected colors from [Radix Colors](https://github.com/radix-ui/colors) 3.0.0. Its MIT license is included in [the frontend assets](web/public/third-party/radix-colors-LICENSE.txt).
The Markdown renderer uses [react-markdown](https://github.com/remarkjs/react-markdown)
10.1.0, Copyright (c) Espen Hovlandsdal, under the same MIT terms.
GFM table parsing uses [remark-gfm](https://github.com/remarkjs/remark-gfm)
4.0.1, Copyright (c) Titus Wormer, under the same MIT terms.
Their complete notices are also included in the installed packages. Markdown
HTML is disabled; remote images are rendered as text, with no image request.

## Document and image support

The Python runtime uses pypdf 7.0.1 (BSD-3-Clause) and ReportLab 4.5.1
(BSD-3-Clause) for PDF processing, python-docx 1.2.0 (MIT) for Word,
openpyxl 3.1.5 (MIT) for Excel, and python-pptx 1.0.2 (MIT) for PowerPoint.
The parser uses defusedxml 0.7.1 (PSFL) to reject unsafe XML constructs and
Pillow 13.0.0 (MIT-CMU) to verify image attachments.

Their packaged dependencies are charset-normalizer 3.5.3 (MIT), et-xmlfile
2.0.0 (MIT), lxml 6.1.3 (BSD-3-Clause), typing-extensions 4.16.0 (PSF-2.0),
and XlsxWriter 3.3.4 (BSD-2-Clause). The Windows runtime includes the
license files from the pinned wheels, including notices for bundled libraries.

## Obsidian Prism

The optional [Obsidian Prism](https://github.com/RMvdesi/obsidian-prism) theme
and its optical widgets are adapted from RMvdesi's work under GPL-3.0-only.
The [license](web/src/themes/obsidian-prism/LICENSE),
[notice](web/src/themes/obsidian-prism/NOTICE), and
[upstream credits](web/src/themes/obsidian-prism/THIRD_PARTY_NOTICES.md) accompany
the theme source and vendor engines.
