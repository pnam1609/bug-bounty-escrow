# Bounty Table — Public program list for Figma

## 1. Mục tiêu

Tài liệu này định nghĩa màn hình **public bounty program listing** của BountyEscrow dưới dạng bảng có filter và infinite scroll. Màn hình giúp researcher tìm program đang nhận report hoặc xem lại program đã kết thúc, so sánh max bounty, total paid và deadline, sau đó mở program detail trước khi gửi report.

Route chính:

```text
/programs
```

Flow liên quan nhưng không nằm trong phạm vi màn hình này:

```text
Bounty table
  → Program detail
  → Submit private report
```

Create program, owner program management và report composer được thiết kế ở các flow/page Figma khác. Page này không được chứa owner-only action hoặc private report data.

## 2. Nguồn sự thật hiện tại

### Product rules

- Public table hiển thị program có trạng thái public, gồm program đang active và program đã kết thúc; active được ưu tiên ở thứ tự mặc định nhưng không phải filter `active only`.
- Program draft, awaiting funding và paused không xuất hiện trong public list. Việc public program `expired`/`closed` cần được backend xác nhận bằng một public lifecycle/status contract rõ ràng.
- Report content và researcher identity không được hiển thị trong bảng.
- Max bounty là dữ liệu chính để researcher đánh giá program. `Total paid` chỉ được công khai khi owner cho phép.
- AI-assisted triage không phải tiêu chí xếp hạng mặc định và không xuất hiện như core product claim.
- Primary value proposition của màn hình là `Guaranteed escrow`, `Transparent reward pool` và `USDC settlement`.

### API hiện tại

```text
GET /api/programs
```

Query contract hiện có:

| Query | Kiểu | Quy tắc |
| --- | --- | --- |
| `page` | positive integer | Mặc định 1 |
| `limit` | positive integer | Web hiện dùng 12; shared default 20; maximum 100 |
| `search` | string | Trimmed, tối đa 120 ký tự; backend search theo program name |
| `sort` | enum | Hiện có `newest`, `deadline`, `name`; UI mới gửi field tương ứng khi người dùng click sortable column header |
| `status` | ProgramStatus | API hiện chỉ cho public `active`; cần mở rộng để trả public ended programs theo yêu cầu mới |

Response:

```ts
type ProgramListResponse = {
  success: true;
  data: Program[];
  metadata: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};
```

Mỗi program trả về:

- `id`, `name`, `slug`, `description`, `status`.
- `totalPool`, `remainingPool`.
- Optional `deadline` và `updatedAt`.
- Danh sách `scopes` với `assetType` và `isInScope`.
- Danh sách `rewardTiers` với severity, min reward và max reward.

API hiện tại **chưa trả về** tổng tiền đã chi và cấu hình public/private của số liệu này. Để triển khai cột `Total paid`, cần mở rộng item response:

```ts
type PublicProgramListItem = Program & {
  totalPaid: string | null;
  totalPaidVisibility: "public" | "private";
};
```

- Khi `totalPaidVisibility="public"`, UI hiển thị số đã format, ví dụ `68.5K USDC`.
- Khi `totalPaidVisibility="private"`, UI chỉ hiển thị `Private`; không render `0`, dấu gạch ngang hoặc tooltip làm lộ số liệu.
- Backend phải quyết định visibility trước khi serialize public response; frontend không được nhận số thật rồi chỉ che bằng CSS.

### Giá trị suy ra cho UI

UI có thể tính ở client từ response hiện tại:

```text
maxBounty = max(rewardTiers[].maxReward)
inScopeCount = count(scopes where isInScope = true)
assetTypes = unique(scopes[].assetType where isInScope = true)
closingLabel = deadline - now, hoặc Ongoing khi không có deadline
```

Không hiển thị exchange-rate conversion sang USD trong MVP vì contract không cung cấp price source. Dùng `USDC` làm unit duy nhất.

## 3. API gap cho filter và total paid

UI table có thể thiết kế filter phong phú để thể hiện product direction, nhưng implementation hiện chỉ hỗ trợ `search` và `sort` cho public list. Public ended-program visibility và status filter là API gap mới.

| Filter trong Figma | Hiện có trong API | Hành vi đề xuất |
| --- | --- | --- |
| Search program | Có | Gửi `search` sau submit hoặc debounce có kiểm soát |
| Column sort | Một phần | Click `Program`, `Max bounty`, `Total paid` hoặc `Deadline`; cần mở rộng enum/backend field mapping cho bounty và total paid |
| Status | Chưa cho public | Thêm public status filter `active\|ended`; mặc định chọn cả hai và xếp active trước |
| Asset type | Chưa | Thêm query `assetType=smart_contract\|website\|api\|mobile` |
| Severity available | Chưa | Thêm query `severity=critical\|high\|medium\|low\|informational` |
| Minimum max bounty | Chưa | Thêm query monetary string, ví dụ `minMaxReward=10000` |
| Deadline | Chưa | Thêm semantic query như `closing=7d\|30d\|ongoing` |
| Funded pool only | Chưa | Thêm boolean `funded=true`, định nghĩa `remainingPool > 0` |
| Total paid visibility | Chưa | Thêm `totalPaid` và `totalPaidVisibility` trên public list item |

Quy tắc handoff:

- Figma/docs phải ghi `API extension required` cho public ended status, asset type, severity, bounty, deadline, funded-only filter, sortable bounty/total-paid columns và `Total paid`.
- Không giả lập các query chưa tồn tại như đã production-ready.
- Nếu frontend triển khai trước backend extension, các advanced filter phải bị ẩn sau feature flag hoặc chỉ filter trong tập dữ liệu đã tải với copy rõ ràng; không được tạo cảm giác đã filter toàn bộ dataset.

## 4. User và job-to-be-done

### Primary user

Security researcher, có thể anonymous hoặc đã đăng nhập.

### User goals

1. Tìm nhanh program theo tên.
2. So sánh max bounty và lịch sử chi trả khi program công khai số liệu.
3. Biết program còn mở trong bao lâu.
4. Dùng filter để thu hẹp theo scope/reward phù hợp kỹ năng.
5. Mở program detail để đọc scope và exclusions trước khi submit.

### Không làm ở table

- Không submit report trực tiếp từ row.
- Không hứa chắc reward hoặc acceptance.
- Không hiển thị private vulnerability count.
- Không cho owner edit/fund/publish từ public table.
- Không tự động xếp hạng bằng AI.

## 5. Information architecture

Desktop frame 1440 × 1024 gồm:

```text
Global header
Page heading + public trust summary
Primary filter dropdowns + search
Applied filter chips / default ordering note + results count
Program table
Infinite-scroll sentinel / loading-more state
Public disclosure / escrow note
```

Desktop content max width: 1312px, centered, horizontal padding 64px.

### Global header

- Product mark: `BountyEscrow`.
- Trong researcher flow, không dùng left sidebar hoặc navigation tabs đặt cố định trên header.
- Authenticated researcher dùng avatar/name làm menu trigger. Menu gồm `Browse programs`, `My reports`, `Rewards · Future`, `Account settings` và button `Logout`.
- Menu avatar trả focus về trigger khi đóng; `Escape` đóng menu; `Logout` là action riêng ở cuối menu sau divider.
- Anonymous actions `Sign in`, `Create account` chỉ áp dụng cho public/unauthenticated entry ngoài researcher flow.
- Không dùng wallet connection làm requirement để browse hoặc submit report.

### Page heading

- H1: `Find your next bounty`.
- Supporting copy: `Compare transparent reward pools, verified scope and USDC payouts before you start researching.`
- Không dùng eyebrow `PUBLIC BOUNTIES`.
- Hero có tối thiểu 32px khoảng trống phía dưới supporting copy trước toolbar/filter region.
- Trust summary chỉ giữ `Escrow balance visible` và `Private reports by default`; không dùng claim `Active programs only`.

## 6. Filter system

### Desktop filter bar

Toolbar desktop dùng pattern dropdown-filter giống data-grid:

1. Nhóm filter button ở trái: `Status`, `Asset type`, `Max bounty`, `More filters`. Mỗi button mở popover neo ngay bên dưới control.
2. Search input `Search in table` nằm phía phải, rộng khoảng 360–400px.
3. Applied filters nằm thành một hàng ngay dưới toolbar dưới dạng removable chips, ví dụ `Status: Active ×`, `Asset: Smart contract ×`.
4. Popover multi-select có search-values input, danh sách checkbox có thể scroll, primary action `Apply`, selected count và `Clear selected`.

Không đặt control Sort trong filter toolbar hoặc filter popover. Sort chỉ được điều khiển bằng sortable column headers của table. Không hiển thị annotation kỹ thuật như `API extension required` trong product UI; ghi annotation bên ngoài frame hoặc trong docs.

Search placeholder:

```text
Search in table
```

Filter options:

| Filter | Options |
| --- | --- |
| Status | Active, Ended; mặc định chọn cả hai |
| Asset type | Smart contract, Website, API, Mobile |
| Severity | Critical, High, Medium, Low, Informational |
| Reward | Any reward, 10K+ USDC, 50K+ USDC, 100K+ USDC |
| Closing | Any deadline, 7 days, 30 days, Ongoing |
| More | Severity, Deadline, Funded pool only |

### Applied-filter row

- Left: `24 bounty programs` hoặc `{n} matching programs`; không gọi toàn bộ result là active.
- Applied filters dùng removable chip, ví dụ `Smart contract ×`, `Critical ×`, `50K+ USDC ×`.
- `Clear all` chỉ xuất hiện khi có ít nhất một advanced filter hoặc search.
- Default status là Active + Ended; active programs được xếp trước, sau đó mới tới ended programs. Đây là default ordering, không phải `active only` filter.
- Khi thay filter hoặc column sort, xoá pages đã cache và tải lại từ `page=1`.
- Filter state đồng bộ với URL để reload, share link và Back/Forward hoạt động đúng.

### Mobile filter

Ở 390px:

- Search chiếm toàn width.
- Button `Filters` full width hiển thị badge số filter đang active.
- Không render mobile Sort select. Mobile giữ default ordering; sortable table headers chỉ áp dụng cho desktop/tablet có header row.
- `Filters` mở bottom sheet full-width có từng filter group và sticky footer.
- Footer actions: secondary `Clear all`, primary `Show 24 bounties`.
- Không update table sau mỗi checkbox trên mobile; apply một lần khi người dùng chọn `Show … bounties`.

### Filter state và error

- Search value tối đa 120 ký tự; ngăn nhập dài hơn và không gửi invalid query.
- Unknown query value phải fallback an toàn về default, không crash UI.
- Browser Back/Forward phải restore control state từ URL.
- Filter request loading giữ table cũ với progress indicator nhỏ; không flash empty state.
- Không announce toàn bộ table bằng screen reader sau mỗi keystroke; announce results count sau request hoàn tất.

## 7. Program table

### Columns

| Column | Nội dung | Desktop width gợi ý |
| --- | --- | --- |
| Program | Logo/monogram và program name, không có description hoặc status badge | 380px |
| Max bounty | Max reward tier, USDC | 220px |
| Total paid | Giá trị USDC hoặc `Private` theo config | 260px |
| Deadline | Relative label + absolute date; `Ongoing` khi null | 220px |
| Action | `View bounty` link/button | 216px |

Header row có padding ngang 24px; mỗi `TableHead` có padding ngang 16–24px để title không dính nhau. Không có column Status; trạng thái ended được biểu đạt trong Deadline (`Ended`) và có thể lọc từ Status dropdown.

### Row behavior

- Row cao khoảng 76–80px.
- Hover dùng `component/table/row/bg-hover` và border brand nhẹ.
- Click row hoặc `View bounty` đi tới `/programs/:id`.
- Có visible focus ring cho keyboard user.
- Không đặt nested interactive controls trong toàn bộ clickable row; implementation nên dùng một stretched link hoặc action cell với semantics hợp lệ.
- `Program`, `Max bounty`, `Total paid` và `Deadline` là sortable header buttons. Click lần đầu sort ascending, lần hai descending; header đang active dùng mũi tên `↑`/`↓`, header chưa active dùng indicator trung tính.
- Sort header phải là button keyboard-accessible trong `TableHead`, có `aria-sort` và focus ring; Action không sortable.

### Formatting

- Monetary values: tối đa 2 decimals khi cần, group thousands, luôn có `USDC`.
- Giá trị lớn có thể compact ở primary line (`250K USDC`) và full value trong accessible label/tooltip.
- Deadline relative label ví dụ `12 days`, secondary `Aug 7, 2026`.
- `Private` dùng text secondary kèm accessible label `Total paid is private`; không dùng blur hoặc che số giả.
- `Ongoing` không dùng màu success quá mạnh; đây là absence of deadline, không phải program health.

### Demo rows cho Figma

| Program | Max bounty | Total paid | Deadline |
| --- | ---: | ---: | --- |
| Aegis Protocol | 250,000 USDC | 68,500 USDC | Ongoing |
| Nebula Lending | 100,000 USDC | Private | 28 days |
| OrbitX Bridge | 75,000 USDC | 23,000 USDC | 12 days |
| Keystone Wallet | 50,000 USDC | Private | Ended Jul 12, 2026 |
| Lumen DEX | 25,000 USDC | 9,250 USDC | Ongoing |
| Vector Oracle | 20,000 USDC | 5,000 USDC | Ended Jun 30, 2026 |

Demo data là synthetic và không được trình bày như live production program.

## 8. Infinite scroll

- Không render pagination controls ở desktop hoặc mobile.
- Dùng `useInfiniteQuery` hoặc abstraction tương đương với API page-based hiện tại: `pageParam=1`, `getNextPageParam = hasNextPage ? page + 1 : undefined`.
- Gắn `IntersectionObserver` vào sentinel sau `TableBody`; khi sentinel vào viewport và `hasNextPage=true`, gọi `fetchNextPage()`.
- Chỉ có một request load-more chạy tại một thời điểm; debounce observer để tránh request trùng.
- Search/filter/column-sort giữ trong URL. Danh sách pages và scroll position có thể giữ trong query cache khi user mở detail rồi Back.
- Initial loading dùng skeleton toàn bảng; loading-more giữ rows cũ và thêm indicator `Loading more bounties…` ở cuối.
- Khi hết dữ liệu, hiển thị `You’ve reached the end` một lần, không tạo dead control.
- Nếu load-more lỗi, giữ nguyên rows đã tải và hiện inline `Couldn’t load more` + `Try again`; không thay toàn bảng bằng error state.

## 9. Screen states cần thiết kế

| ID | Frame | Mục đích |
| --- | --- | --- |
| BT-01 | Default table | 6 demo rows gồm active và ended; active đứng trước |
| BT-02 | Filters applied | Asset, severity và reward chip active |
| BT-03 | Filter popover | Desktop multi-select state |
| BT-04 | Loading | Initial table skeleton |
| BT-05 | Loading more | Giữ rows cũ, sentinel spinner ở cuối table |
| BT-06 | Empty initial | Không có public bounty program |
| BT-07 | Empty filtered | Không có kết quả, có `Clear filters` |
| BT-08 | Error | Retry action, không xoá filter state |
| BT-09 | Mobile default | Vertical table representation ở 390px |
| BT-10 | Mobile filters | Bottom sheet với applied count và sticky actions |

### Loading

- Initial loading: skeleton cho heading meta, filter controls và 6 rows.
- Không dùng fake data trong loading state.
- Refreshing sau filter: rows cũ giữ opacity bình thường; progress indicator nhỏ trong toolbar giúp tránh layout shift.
- Loading-more: rows đã tải không đổi; thêm spinner và copy ở sentinel cuối danh sách.

### Empty initial

Copy:

```text
No bounty programs yet
New public programs will appear here when they are published.
```

Không có `Clear filters` vì không có filter.

### Empty filtered

Copy:

```text
No bounties match these filters
Try removing a filter or searching for a different program.
```

Primary: `Clear all filters`.

### Error

Copy:

```text
We couldn’t load bounties
Your filters are still here. Try again in a moment.
```

Primary: `Retry`.

Không log response body hoặc thông tin nhạy cảm trong UI.

## 10. Responsive behavior

- Từ 768px trở lên: dùng shadcn `Table` với đúng 5 column: Program, Max bounty, Total paid, Deadline, Action.
- 1440px: dùng full desktop widths; 1024/1280px co Program/Total paid nhưng giữ gap tối thiểu 16px trong `TableHead` và `TableCell`.
- Dưới 768px: không dùng horizontal scroll. Mỗi record chuyển thành **vertical table row** dạng bordered block, gồm program header và các hàng label/value: `Max bounty`, `Total paid`, `Deadline`, sau cùng là `View bounty` full width.
- Mobile vertical table dùng cùng data source và formatter với desktop. Có thể render bằng `<dl>` hoặc một mobile-only semantic list; không ép HTML `<table>` thành layout làm mất semantics.
- Desktop và mobile có thể cùng tồn tại trong DOM theo breakpoint nếu đảm bảo bản hidden không được screen reader đọc (`hidden`/`aria-hidden` đúng cách).

### Kiểm tra tương thích shadcn/ui

- Desktop mapping trực tiếp sang `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`.
- Table container dùng `overflow-hidden rounded-md border`; infinite scroll sentinel đặt sau `TableBody` hoặc ngay dưới table container, không dùng component `Pagination`.
- Search dùng `Input`; từng filter dùng `Button` + `Popover` ở desktop và một `Sheet` tổng hợp ở mobile. Sort dùng button trong `TableHead`, không dùng `Select`.
- shadcn Data Table là hướng dẫn composable trên TanStack Table, không phải component đóng. Vì vậy infinite scroll và stacked mobile layout là behavior tùy biến của feature này.
- shadcn Table không tự biến table thành stacked rows trên mobile; breakpoint mobile phải render component `BountyVerticalRow` riêng để tránh overflow ngang.

## 11. Accessibility

- Table có accessible caption `Active bounty programs`.
- Header cells dùng `scope=column` trong implementation.
- Search có label rõ ràng; placeholder không thay thế label.
- Filter count và result count được announce khi apply hoàn tất.
- Removable chip có accessible name như `Remove Smart contract filter`.
- Dropdown và bottom sheet có focus trap/return focus đúng.
- Interactive target tối thiểu khoảng 44 × 44px.
- Focus ring dùng `color/focus/default`, đạt WCAG AA trên dark background.
- Severity/asset/status không chỉ khác nhau bằng màu; luôn có text.
- Monetary values có accessible label đầy đủ, ví dụ `250,000 USDC maximum bounty`.
- Respect `prefers-reduced-motion`; không dùng shimmer chuyển động bắt buộc.

## 12. Privacy, trust và security copy

Footer note dưới table:

```text
Reward pools are shown in USDC. Always review the complete in-scope assets and exclusions before testing or submitting a report.
```

Optional trust row:

- `Escrow balance visible`.
- `Private reports by default`.

Không dùng claim `guaranteed payout`; escrow chỉ đảm bảo nguồn tiền minh bạch, còn report vẫn cần human validation và reward approval.

## 13. Figma placement và naming

- File: dùng file BBE hiện tại có `BBE Design System`.
- Đặt toàn bộ table vào page `researcher`, section `Researcher · Browse → Program detail → Submit bug flow`; không giữ page tạm `bounty table`.
- Happy-path desktop xếp theo thứ tự: `RS-00 · Browse bounties · Desktop` → `PG-DETAIL · Program entry · Desktop` → `SR-01 · Scope · Desktop` → các bước submit tiếp theo.
- BT-02 đến BT-08 đặt ở supporting-state row phía dưới happy path. BT-09 và BT-10 đặt trước các mobile submit-report states.
- `View bounty` trên desktop row và mobile vertical row có prototype navigation tới `PG-DETAIL`.
- Desktop Program Detail và Submit bug screens không có Researcher Sidebar. Content dùng full app-shell width 1440px và content max-width 1104px được căn giữa.
- Có state `RS-NAV-01 · Account menu open · Desktop` và reusable component `Researcher Account Menu` để mô tả avatar dropdown + Logout.
- Layer names semantic English; không dùng `Rectangle 123` hoặc `Group 8`.
- Flow starting point: `RS-00 · Browse bounties · Desktop`.

## 14. BBE Design System mapping

Ưu tiên semantic Variables và component instance trong `BBE Design System`.

| Figma pattern | Existing BBE asset / implementation mapping |
| --- | --- |
| Primary/secondary/ghost actions | `Button` variants / shared Button |
| Search | `Input` with search icon |
| Filter dropdown trigger | Secondary `Button` + `Popover` |
| Column sort | Ghost button inside `TableHead` + `aria-sort` |
| Checkbox filter | `Selection Control` |
| Program status | `Status Badge` khi variant phù hợp; nếu chưa có Active thì dùng semantic badge local |
| Applied filter | Local reusable Filter Chip component |
| Program row | Local reusable Bounty Table Row component |
| Mobile program row | Local reusable Bounty Vertical Row component |
| Table container | Card/surface using `component/card/*` and `component/table/*` variables |
| Loading/error/empty | Semantic state component/callout |
| Infinite scroll sentinel | Spinner/status text; retry dùng Button ghost/secondary |

Token rules:

- Bind color bằng `color/bg/*`, `color/text/*`, `color/border/*`, `color/status/*`, `color/severity/*`, `color/accent/*`.
- Table header dùng `component/table/header/bg`.
- Row hover dùng `component/table/row/bg-hover`.
- Spacing theo 4/8/12/16/24/32/48.
- Radius dùng semantic `radius/md`, `radius/lg`, `radius/full`.
- Typography dùng Inter và text styles hiện có: Display/XL, Heading/H1–H3, Body/Large–Small, Label/Large–Small.
- Purple/violet cho brand/current action; mint cho escrow/trust; USDC blue cho token metadata; rose/orange/yellow chỉ cho severity/status phù hợp.

## 15. Prototype scenarios

1. `RS-00` → click Aegis row hoặc `View bounty` → `PG-DETAIL`.
2. `PG-DETAIL` → `Submit a private report` → `SR-01` → tiếp tục Submit bug flow.
3. Default table → search `Aegis` → loading/refreshing → one result.
4. Open Asset type → select Smart contract → apply → chip active.
5. Add Critical và 50K+ reward → BT-02.
6. Remove one chip → results update và infinite list reset về page 1.
7. Clear all → RS-00.
8. Apply filter không có match → BT-07 → Clear all.
9. Request error → BT-08 → Retry → RS-00/BT-02 giữ filter.
10. Scroll tới sentinel → tải page 2 và append rows mà không đổi scroll position.
11. Mobile Filters → chọn options → `Show 24 bounties` → mobile results → click row → `PG-DETAIL`.
12. Click avatar/name → `RS-NAV-01`; chọn navigation item hoặc `Logout`.

## 16. Acceptance criteria

- Public table hiển thị active và ended public programs, ưu tiên active ở default ordering và không lộ owner/private report data.
- Program cell chỉ có logo + name; Max bounty, Total paid và Deadline hiển thị rõ.
- Có search, sortable column headers, advanced filter dropdowns, applied chips, clear-all và URL-sync behavior.
- Mọi filter chưa có API và `Total paid` đều được ghi là `API extension required` trong docs/annotation, không lộ annotation trong product UI.
- Có Status filter Active/Ended; mặc định chọn cả hai, không dùng `Active programs only`.
- Có default, applied, popover, initial loading, refreshing, empty, error và mobile states.
- Không có pagination; infinite scroll có initial/loading-more/end/error states.
- Table desktop phù hợp cấu trúc shadcn Table; mobile chuyển sang vertical table blocks, không horizontal scroll.
- Không hứa guaranteed payout và không đặt AI làm ranking/gate.
- Dùng BBE Design System, semantic variables, Inter, component instances và reusable local desktop/mobile table-row/filter-chip components.
- Figma tích hợp table vào đầu researcher Submit bug flow; không còn page tạm `bounty table`.
- Desktop researcher shell không có sidebar; avatar dropdown chứa Browse programs, My reports, Rewards, Account settings và Logout.
- Prototype nối desktop/mobile bounty row tới Program Detail, sau đó Program Detail nối tiếp Submit bug flow.
