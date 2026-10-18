# Film Sim Lab

Web app chạy hoàn toàn trên trình duyệt: tải ảnh lên, áp Film Simulation kiểu Fujifilm cùng recipe đầy đủ, xử lý bằng WebGL. Ảnh không rời khỏi máy.

**Demo:** https://ndlong78.github.io/Fujifilm-sim/

## Tính năng
- 14 film simulation: Provia, Velvia, Astia, Classic Chrome, Pro Neg Hi/Std, Classic Neg, Nostalgic Neg, Reala Ace, Eterna, Eterna Bleach Bypass, Acros (Std/Ye/R/G), Monochrome, Sepia.
- Recipe: DR100/200/400, Highlight/Shadow (−2…+4), Color, Color Chrome Effect, FX Blue, WB Auto/Kelvin + Shift R/B, Sharpness, Clarity, Grain (Weak/Strong, Small/Large), Exposure (1/3 EV), Monochromatic WC/MG.
- 7 recipe dựng sẵn, recipe card để chép lên máy, lưu recipe vào localStorage.
- Thanh so sánh trước/sau, kéo-thả / dán ảnh, xuất JPEG độ phân giải gốc (tối đa 6144px).
- Nạp LUT 3D `.cube` (đến 129³, hỗ trợ `DOMAIN_MIN/MAX`) với thanh cường độ; LUT áp sau film sim, trước sharpness/grain. Texture LUT dùng float32, tự lùi về float16 rồi 8-bit nếu GPU không hỗ trợ lọc tuyến tính (độ chính xác hiện ở góc mục LUT).
- Đồng bộ recipe bằng JSON: chép recipe hiện tại hoặc toàn bộ recipe đã lưu, dán/mở file `.json` để nạp (giá trị ngoài dải được kẹp về giới hạn của máy).

## Chạy local
Mở thẳng `index.html` trên trình duyệt, hoặc:
```bash
python3 -m http.server 8000   # http://localhost:8000
```

## Cấu trúc
- `film-sim-lab.html` — **file nguồn** (fragment, cũng dùng cho Claude Artifact). Chỉ sửa file này.
- `index.html` — trang hoàn chỉnh cho GitHub Pages, sinh ra bằng `./build.sh`. Sau khi sửa nguồn, chạy `./build.sh` rồi commit cả hai.
- `tools/simmodel.py` — bản NumPy của pipeline màu trong shader; `tools/parity_test.mjs` kiểm tra hai bản khớp nhau từng pixel.
- `tools/calibrate.py` — fit tham số một sim từ cặp ảnh Fuji thật.

## Mô hình màu
Mỗi sim trong mảng `SIMS` là một bộ tham số áp lên ảnh đầu vào (coi như bản render chuẩn kiểu Provia):
đường cong tông theo từng kênh, rồi chỉnh hue / chroma / lightness cho 6 vùng màu trong **OKLCh**
(tâm vùng là hue của R/Y/G/C/B/M trong sRGB, nội suy mượt giữa các tâm), split-tone theo OKLab a/b,
và gamut mapping giảm chroma giữ nguyên hue thay vì cắt từng kênh. Decode/encode theo đường cong sRGB chuẩn.
Giá trị hiện tại chỉnh tay theo mô tả của Fujifilm, **không phải LUT chính hãng**.

## Hiệu chỉnh từ máy Fuji thật
1. Chụp 1 file RAW cảnh nhiều màu (tốt nhất có ColorChecker). Dùng chuyển RAW trong máy hoặc X RAW STUDIO xuất 2 JPEG
   cùng thiết lập: DR100, WB cố định, Highlight/Shadow/Color 0, Color Chrome Off, Sharpness/Clarity 0, Grain Off.
   Một ảnh **Provia** (`base.jpg`), một ảnh sim cần fit (`target.jpg`).
2. Chạy:
   ```bash
   pip install numpy scipy pillow
   python3 tools/calibrate.py base.jpg target.jpg --sim cc        # mono: --sim acros --filter r
   ```
   Script in sai số trước/sau (khoảng cách OKLab ×100, ~1 là ngưỡng mắt thấy) và dòng `SIMS` mới để dán vào `film-sim-lab.html`.
3. `./build.sh`, rồi `node tools/parity_test.mjs` (cần `playwright`) để chắc shader và bản Python vẫn khớp.
