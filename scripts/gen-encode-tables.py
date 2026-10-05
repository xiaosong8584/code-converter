#r"""一次性生成脚本：产出 src/encode-tables.ts（乱码修复用的编码回转表 + 常用字位图）。
# 产物已提交进仓库，日常构建不需要重跑本脚本；仅当要扩充 Big5/Shift-JIS 等表时再跑。
#
# 用法：python scripts/gen-encode-tables.py
#"""
import base64
import sys

OUT = "src/encode-tables.ts"


def gen_gbk():
    """所有'非 ASCII 且有 GBK 双字节编码'的字符 → (码点数组, GBK 序列数组)，按码点升序。"""
    uni = []
    seq = bytearray()
    for c in range(0x80, 0x110000):
        if 0xD800 <= c <= 0xDFFF:
            continue
        ch = chr(c)
        try:
            b = ch.encode("gbk")
        except UnicodeEncodeError:
            continue
        if len(b) != 2:
            continue
        uni.append(c)
        seq += b
    return uni, bytes(seq)


def gen_gb2312_l1_bitset():
    """GB2312 一级常用汉字（约 3755 个，最常用中文）位图。
    区间 [0x4E00, 0x9FA5]，用于乱码修复的'常用字命中率'判别：
    正确解码的中文几乎全落在一级字库内，误读出的垃圾字大量落在区间外。"""
    lo, hi = 0x4E00, 0x9FA5
    nbits = hi - lo + 1
    bits = bytearray((nbits + 7) // 8)
    count = 0
    for c in range(lo, hi + 1):
        try:
            b = chr(c).encode("gb2312")
        except UnicodeEncodeError:
            continue
        if len(b) == 2 and 0xB0 <= b[0] <= 0xD7 and 0xA1 <= b[1] <= 0xFE:
            i = c - lo
            bits[i >> 3] |= 1 << (i & 7)
            count += 1
    return lo, bits, count


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def main():
    uni, seq = gen_gbk()
    l1_lo, l1_bits, l1_count = gen_gb2312_l1_bitset()
    lo, hi = 0x4E00, 0x9FA5  # 位图区间（docstring 展示用）
    # 显式小端两字节，运行期手工组装（不依赖 Uint16Array 的平台字节序）
    uni_le = b64(b"".join(c.to_bytes(2, "little") for c in uni))
    src = f"""/**
 * 乱码修复工具数据表（自动生成，勿手改）。
 * 生成：python scripts/gen-encode-tables.py
 *
 * 1) GBK 编码回转表：把"UTF-8 被误读为 GBK"的文本编码回转成原始字节。
 *    UNI 为升序码点表（显式小端），SEQ 为对应 GBK 双字节序列；运行期二分查找。
 *    条目数：{len(uni)}
 * 2) GB2312 一级常用字位图（区间 [0x{lo:04X}, 0x{hi:04X}]，{l1_count} 字）：
 *    修复质量判别——正确解码的中文几乎全是一级常用字，误读垃圾字大量落在区间外。
 */

const GBK_UNI_B64 =
\t"{uni_le}";
const GBK_SEQ_B64 =
\t"{b64(bytes(seq))}";
const L1_BITSET_B64 =
\t"{b64(l1_bits)}";

function b64ToBytes(b64: string): Uint8Array {{
\tconst bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
\tconst out = new Uint8Array(bin.length);
\tfor (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
\treturn out;
}}

// 显式小端组装，避免 Uint16Array 平台字节序差异
const GBK_UNI = (() => {{
\tconst b = b64ToBytes(GBK_UNI_B64);
\tconst u = new Uint16Array(b.length / 2);
\tfor (let i = 0; i < u.length; i++) u[i] = b[i * 2] | (b[i * 2 + 1] << 8);
\treturn u;
}})();
const GBK_SEQ = b64ToBytes(GBK_SEQ_B64);
const L1_BITS = b64ToBytes(L1_BITSET_B64);
const L1_LO = 0x{lo:04X};
const L1_HI = 0x{hi:04X};

/** 单个字符编码回转为 GBK 字节；无映射返回 null */
export function charToGbk(code: number): Uint8Array | null {{
\tlet lo2 = 0;
\tlet hi2 = GBK_UNI.length - 1;
\twhile (lo2 <= hi2) {{
\t\tconst mid = (lo2 + hi2) >> 1;
\t\tconst v = GBK_UNI[mid];
\t\tif (v === code) return GBK_SEQ.subarray(mid * 2, mid * 2 + 2);
\t\tif (v < code) lo2 = mid + 1;
\t\telse hi2 = mid - 1;
\t}}
\treturn null;
}}

/** 是否 GB2312 一级常用汉字 */
export function isCommonHanzi(code: number): boolean {{
\tif (code < L1_LO || code > L1_HI) return false;
\tconst i = code - L1_LO;
\treturn (L1_BITS[i >> 3] & (1 << (i & 7))) !== 0;
}}
"""
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)
    size = len(src.encode("utf-8"))
    print(f"OK: {OUT}  gbk_entries={len(uni)}  l1_chars={l1_count}  size={size/1024:.1f} KB")


if __name__ == "__main__":
    sys.exit(main())
