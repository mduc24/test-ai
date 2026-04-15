# Gemini CLI — Findings & Insights

> Tổng hợp từ quá trình "phỏng vấn" Gemini CLI để hiểu mạnh/yếu trước khi orchestrate.
> Phương pháp: chạy test prompts thực tế + đọc source code GeminiCliAdapter + đọc session files.

---

## 1. Tools Gemini có sẵn

```
list_directory        read_file           grep_search
glob                  write_file          replace
run_shell_command     google_web_search   web_fetch
save_memory           activate_skill      enter_plan_mode
cli_help              codebase_investigator   generalist
```

### Đáng chú ý:
- **`codebase_investigator`** — sub-agent chuyên trace codebase
- **`generalist`** — sub-agent đa năng
- **`save_memory`** — memory riêng của Gemini, persist qua sessions
- **`run_shell_command`** — chỉ hoạt động khi chạy với `--yolo` flag

---

## 2. Slash commands quan trọng

```
/compress    → nén conversation history, giữ context bỏ noise
/plan        → enter plan mode trước khi implement
/rewind      → undo action gần nhất
/restore     → rollback về checkpoint
/memory      → quản lý memory
/agents      → quản lý sub-agents
/resume      → resume session cũ
/clear       → clear conversation
/skills      → quản lý skills
```

---

## 3. Gemini tự nhận xét (nguyên văn)

> *"My primary strength lies in strategic orchestration — efficiently delegating complex or high-volume tasks to specialized sub-agents to maintain context efficiency while delivering polished, functional results. Conversely, I struggle with tasks that require real-time human clarification or involve highly ambiguous requirements."*

**Insight**: Gemini tự nhận mình là **orchestrator**, không phải worker. Khi bị ép làm pure implementor, nó improvise nhiều hơn vì đang làm trái vai.

---

## 4. Điểm mạnh (confirmed qua test)

**Pattern following khi có code mẫu cụ thể** ✅

Khi được cho đoạn code mẫu thật, Gemini copy pattern chính xác:
```python
# Prompt: "follow this exact pattern"
# Input example:
def get_price(self, portal):
    if portal == 'vendor':
        return self.vendor_price
    return self.default_price

# Gemini output — đúng hoàn toàn:
def get_discount(self, portal):
    if portal == 'vendor':
        return self.vendor_discount
    return self.default_discount
```

**End-to-end task ownership** ✅

Gemini tốt khi được giao goal rõ ràng và tự quyết cách làm. Tự research → plan → implement tốt hơn là làm theo spec từng dòng.

---

## 5. Điểm yếu (confirmed qua test)

**Không tuân theo "report only" instruction** ❌

Khi prompt hỏi "Nếu chưa làm task thì trả về NOT_DONE", Gemini bỏ qua instruction và bắt đầu thực hiện task luôn. `[REPORT BACK]` format không đủ để stop Gemini khỏi tự làm.

**Tool name guessing** ❌

Khi không có `--yolo`, Gemini thử dùng `run_shell_command` nhưng bị "Tool not found" — tự đoán tool name thay vì báo lỗi rõ ràng.

**Không thể chạy parallel instances** ❌

3 instances đồng thời → 429 rate limit ngay lập tức. Gemini free tier không support parallel agents — DEV và QA phải chạy sequential.

**Conversation bloat** ❌

Không có context reset thực sự. Message "Ignore all previous context" không làm gì — Gemini vẫn thấy toàn bộ history. Sau nhiều passes, conversation trở thành bãi rác ảnh hưởng chất lượng output.

---

## 6. Session storage

```
~/.gemini/tmp/<project-name>/chats/session-TIMESTAMP.json
```

Schema:
```json
{
  "sessionId": "uuid",
  "projectHash": "...",
  "lastUpdated": "ISO timestamp",
  "messages": [
    {"id": "...", "timestamp": "...", "type": "user|gemini|info", "content": "..."}
  ]
}
```

**Status detection logic** (từ GeminiCliAdapter):
- `lastUpdated > 5 phút` → **IDLE**
- Last message type = `user` → **RUNNING** (Gemini đang xử lý)
- Last message type = `gemini` → **WAITING** (xong, chờ input tiếp)

**Limitation**: Task chạy >5 phút bị mark IDLE sai → orchestrator tưởng agent chết.

---

## 7. Bug trong ai-devkit GeminiCliAdapter

`agent detail` không hoạt động với Gemini vì 2 bug:

```typescript
// Bug 1 — GeminiCliAdapter.ts:172
sessionFilePath: undefined,  // ← không bao giờ được set

// Bug 2 — agent.ts:323
const adapters = {
    claude: claudeAdapter,
    codex: codexAdapter,
    // gemini_cli: ← bị bỏ sót
};
```

Fix: set `sessionFilePath` từ `latestFile` + thêm `gemini_cli: geminiAdapter` vào map.

---

## 8. `/plan` mode behavior (confirmed qua test)

Khi Gemini enter `/plan` mode, nó vào **Consult phase** trước:

> *"I am waiting for your **informal approval** of the following strategy before I proceed to draft the formal plan"*

Flow:
```
Enter /plan → Consult phase (đề xuất strategy, CHỜ approval)
           → Draft phase (viết plan chi tiết)
           → Execute phase (implement)
```

**Implication cho orchestration**: Orchestration có thể dùng `/plan` để Gemini tự propose implementation approach TRƯỚC khi code. Claude nhận plan, approve hoặc correct, rồi Gemini mới implement. Ít improvise hơn vì Gemini đã commit vào một hướng cụ thể.

---

## 9. `[CONSTRAINT]` scope compliance (confirmed qua test)

Test: Yêu cầu add comment vào `README.md`, constraint `Do NOT touch orchestration-workflow.md`.

Kết quả: **Gemini tôn trọng hoàn toàn** — chỉ touch `README.md`, report back đúng format:
```
DONE | files: README.md
```

**Implication**: `[CONSTRAINT]` trong prompt hoạt động tốt cho file-level scope. Không cần liệt kê từng file được phép — chỉ cần nói rõ file nào KHÔNG được touch.

---

## 10. `save_memory` — thực tế khác với tưởng

**Tool signature thực tế** (từ internal docs):
```
save_memory(fact: string)  // chỉ 1 argument — free-form text
```

**Storage**: Append vào `~/.gemini/GEMINI.md` (global, không phải project-specific):
```markdown
## Gemini Added Memories
- <fact text>
- <fact text>
```

**Loading**: Tự động load vào mọi session tiếp theo qua hierarchical context system.

**Quan trọng**: `save_memory` **KHÔNG available trong headless mode** (`-p` flag). Chỉ hoạt động trong interactive session. → Khi dùng `agent send`, memory sẽ hoạt động. Khi test bằng `-p`, sẽ bị "Tool not found".

---

## 11. `/compress` behavior (confirmed qua test)

Khi compress conversation history, Gemini **retain**:
- Specific functional changes (tên field, loại fix)
- Verification outcomes (số test pass)
- Final state (số commits, trạng thái repo)
- Core intent của mỗi instruction

**Discard**:
- Turn-by-turn "Done" acknowledgments
- Chronological sequence của intermediate steps
- Redundant status updates

**Implication**: `/compress` an toàn để dùng giữa các TDD behaviors — Gemini giữ lại đủ context để tiếp tục nhưng bỏ noise. Không mất thông tin về state hiện tại.

---

## 12. Hooks system — powerful, chưa được khai thác

Gemini có hook system đầy đủ. Events available:

| Category | Events |
|---|---|
| Session | `SessionStart`, `SessionEnd` |
| Agent turn | `BeforeAgent`, `AfterAgent` |
| Model | `BeforeModel`, `AfterModel`, `BeforeToolSelection` |
| Tool | `BeforeTool`, `AfterTool` |
| System | `PreCompress`, `Notification` |

**Hooks có thể làm**:
- Inject `additionalContext` vào prompt
- Block execution (`decision: "deny"`)
- Terminate agent loop (`continue: false`)
- Force retry (`AfterAgent`)
- Filter available tools (`BeforeToolSelection`)
- Display messages in terminal (`systemMessage`)

**Hooks đặc biệt hữu ích cho orchestration**:

| Hook | Use case |
|---|---|
| `AfterAgent` | Validate output format — nếu không đúng `DONE \| files: \| ...` format → force retry tự động |
| `BeforeTool` | Block `write_file` nếu path nằm ngoài allowed scope |
| `BeforeToolSelection` | Whitelist tools cho từng role (DEV: no test files, QA: no prod files) |
| `AfterAgent` + retry | Thay thế correction loop — Gemini tự retry khi output sai format |

**Killer use case**: Thay vì Claude phải verify Gemini output rồi gửi corrective instruction, dùng `AfterAgent` hook để auto-retry khi response không match expected format. Giảm round-trips đáng kể.

---

## 13. Rate limit pattern (observed)

Headless mode (`-p`) hit 429 rất nhanh — khoảng **1-2 requests/phút** trước khi bị throttle.

Retry pattern của Gemini CLI: backoff tăng dần (5s → 10s → 22s → 30s...).

**Interactive mode** (tmux session) có limit khác — cao hơn đáng kể, đây là lý do orchestration thực tế qua `agent send` ít gặp 429 hơn test headless.

**Implication**: Test headless không reflect được behavior thật của interactive session. Khi test orchestration nên dùng tmux session thay vì `-p`.

---

## 14. `codebase_investigator` limitation (observed)

Khi được hỏi về `GeminiCliAdapter` trong `ai-devkit`, `codebase_investigator` tìm câu trả lời bằng cách đọc file `gemini-cli-findings.md` trong thư mục hiện tại (claude-orchestration) thay vì tìm trong ai-devkit.

**Behavior**: `codebase_investigator` search trong **current project directory**, không global. Nếu project không chứa file liên quan → nó dùng bất kỳ context available nào, kể cả documentation files.

**Implication**: Để `codebase_investigator` hoạt động đúng, Gemini phải được chạy từ **đúng project directory**. Khi orchestrate FMI project, Gemini agents phải được start từ FMI project dir.

---

## 15. `save_memory` không tồn tại ở headless mode — tool availability khác nhau

Danh sách tools **thay đổi tùy mode**:
- **Interactive (`--yolo`)**: Đầy đủ tools gồm `save_memory`, `activate_skill`
- **Headless (`-p`)**: Subset nhỏ hơn — `save_memory` không available

Khi orchestration gửi instruction qua `agent send` (interactive session), tools đầy đủ. Đây là điểm quan trọng khi design prompts — không assume tool availability giống headless test.

---

## 16. Recommendations cho orchestration

| Vấn đề | Giải pháp |
|---|---|
| Conversation bãi rác | `/compress` sau mỗi TDD behavior — safe, giữ đủ context |
| Gemini improvise | `[RESEARCH]` + `/plan` trước implement — Gemini commit vào hướng cụ thể |
| Correction loop nhiều | `AfterAgent` hook auto-retry khi output sai format — giảm round-trips |
| Scope violation | `[CONSTRAINT]` hoạt động tốt — list files NOT allowed |
| Stuck agent | `--yolo` + `BeforeTool` hook block dangerous tools |
| Status detection sai | Đọc `~/.gemini/tmp/<project>/chats/*.json` trực tiếp |
| Gemini "DONE" không đáng tin | Verify qua `git log`, không trust self-report |
| Parallel limit | Sequential only — 1 instance tại 1 thời điểm |
| Memory mất sau session | `save_memory` trong interactive session → persist vào `~/.gemini/GEMINI.md` |
| `codebase_investigator` search sai dir | Start Gemini từ đúng project directory |

---

## 9. Kiến trúc vai trò tối ưu

```
Claude (PM) — đặt GOAL + CONSTRAINT, verify outcome, quyết định escalation
    │
    ├── Gemini DEV (Mini Tech Lead)
    │     codebase_investigator → /plan → implement → /compress giữa tasks
    │
    └── Gemini QA (Tester)
          re-read file mới nhất → viết failing test → assert concrete values
```

Claude tiết kiệm context bằng cách không research codebase —
chỉ scan `critical_constraints` (list ngắn) trước mỗi RED-GREEN cycle.
