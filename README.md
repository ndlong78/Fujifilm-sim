# Film Sim Lab

Web app chạy hoàn toàn trên trình duyệt: tải ảnh lên, áp Film Simulation kiểu Fujifilm cùng recipe đầy đủ, xử lý bằng WebGL. Ảnh không rời khỏi máy.

**Demo:** https://ndlong78.github.io/Fujifilm-sim/

## Tính năng
- 14 film simulation: Provia, Velvia, Astia, Classic Chrome, Pro Neg Hi/Std, Classic Neg, Nostalgic Neg, Reala Ace, Eterna, Eterna Bleach Bypass, Acros (Std/Ye/R/G), Monochrome, Sepia.
- Recipe: DR100/200/400, Highlight/Shadow (−2…+4), Color, Color Chrome Effect, FX Blue, WB Auto/Kelvin + Shift R/B, Sharpness, Clarity, Grain (Weak/Strong, Small/Large), Exposure (1/3 EV), Monochromatic WC/MG.
- 7 recipe dựng sẵn, recipe card để chép lên máy, lưu recipe vào localStorage.
- Thanh so sánh trước/sau, kéo-thả / dán ảnh, xuất JPEG độ phân giải gốc (tối đa 6144px).
- Nạp LUT 3D `.cube` (đến 129³, hỗ trợ `DOMAIN_MIN/MAX`) với thanh cường độ; LUT áp sau film sim, trước sharpness/grain.
- Đồng bộ recipe bằng JSON: chép recipe hiện tại hoặc toàn bộ recipe đã lưu, dán/mở file `.json` để nạp (giá trị ngoài dải được kẹp về giới hạn của máy).

## Chạy local
Mở thẳng `index.html` trên trình duyệt, hoặc:
```bash
python3 -m http.server 8000   # http://localhost:8000
```

## Cấu trúc
- `film-sim-lab.html` — **file nguồn** (fragment, cũng dùng cho Claude Artifact). Chỉ sửa file này.
- `index.html` — trang hoàn chỉnh cho GitHub Pages, sinh ra bằng `./build.sh`. Sau khi sửa nguồn, chạy `./build.sh` rồi commit cả hai.
- Tham số từng sim nằm trong mảng `SIMS` (dịch hue / saturation / luminance 6 vùng màu, đường cong tông, split-tone, black lift). Đây là mô phỏng gần đúng, không phải LUT chính hãng Fujifilm.
