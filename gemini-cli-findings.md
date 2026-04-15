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

## 8. Recommendations cho orchestration

| Vấn đề | Giải pháp |
|---|---|
| Conversation bãi rác | Gửi `/compress` cho Gemini sau mỗi TDD behavior |
| Gemini improvise khi thiếu context | Thêm `[RESEARCH]` — Gemini tự dùng `codebase_investigator` + `/plan` trước khi code |
| Correction loop nhiều | Đặt `[GOAL]` (outcome) thay vì `[TASK]` + `[SCOPE]` (steps) chi tiết |
| Stuck agent vì confirmation prompt | Luôn start Gemini với `--yolo` |
| Status detection sai | Đọc session JSON trực tiếp thay vì dùng `agent detail` |
| Gemini "DONE" không đáng tin | Luôn verify qua `git log`, không trust self-report |
| Parallel limit | Chỉ chạy 1 Gemini instance tại một thời điểm |

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
