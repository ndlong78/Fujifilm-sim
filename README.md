# Film Sim Lab

Web app chạy hoàn toàn trên trình duyệt: tải ảnh lên, áp Film Simulation kiểu Fujifilm cùng recipe đầy đủ, xử lý bằng WebGL. Ảnh không rời khỏi máy.

**Demo:** https://ndlong78.github.io/Fujifilm-sim/

## Tính năng
- 14 film simulation: Provia, Velvia, Astia, Classic Chrome, Pro Neg Hi/Std, Classic Neg, Nostalgic Neg, Reala Ace, Eterna, Eterna Bleach Bypass, Acros (Std/Ye/R/G), Monochrome, Sepia.
- Recipe: DR100/200/400, Highlight/Shadow (−2…+4), Color, Color Chrome Effect, FX Blue, WB Auto/Kelvin + Shift R/B, Sharpness, Clarity, Grain (Weak/Strong, Small/Large), Exposure (1/3 EV), Monochromatic WC/MG.
- 7 recipe dựng sẵn, recipe card để chép lên máy, lưu recipe vào localStorage.
- Thanh so sánh trước/sau, kéo-thả / dán ảnh, xuất JPEG độ phân giải gốc (tối đa 6144px).

## Chạy local
Mở thẳng `index.html` trên trình duyệt, hoặc:
```bash
python3 -m http.server 8000   # http://localhost:8000
```

## Cấu trúc
- `index.html` — trang hoàn chỉnh (dùng cho GitHub Pages).
- `film-sim-lab.html` — cùng nội dung, dạng fragment cho Claude Artifact.
- Tham số từng sim nằm trong mảng `SIMS` (dịch hue / saturation / luminance 6 vùng màu, đường cong tông, split-tone, black lift). Đây là mô phỏng gần đúng, không phải LUT chính hãng Fujifilm.
