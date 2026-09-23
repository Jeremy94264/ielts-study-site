"""释义补全模块
------------------------------------------------------------
参考词表（2012 版）里没有收录的词，按以下优先级补释义：

  1. exact      精确命中参考表
  2. flat       去掉空格/连字符后命中
  3. singular   单数化后命中（复数 -> 单数，这是最主要的缺口）
  4. derived    -ing / -ed / -ness 等派生词还原后命中
  5. part       复合词拆分后命中
  6. curated    参考表确实没有，用人工补充的释义（标 cur 标记，界面上会标注"补充"）
------------------------------------------------------------
"""
import json, re, collections

# ---------------- 人工补充释义（参考词表未收录的词） ----------------
# 这些词经过确认不在参考词表 2032 条中，释义由人工补充
CURATED = {
    # 名词
    "adventure":    "n. 冒险；奇遇；冒险经历",
    "accuracy":     "n. 准确性，精确度",
    "badge":        "n. 徽章，标记；象征",
    "city":         "n. 城市，都市；全市居民",
    "cola":         "n. 可乐饮料",
    "chemist's":    "n. 药房；药剂师（chemist 的所有格）",
    "cloth":        "n. 布，布料；一块布",
    "contract":     "n. 合同，契约；v. 缔结，订约；收缩",
    "contracts":    "n. 合同（contract 的复数）；v. 缔结，收缩",
    "complaint":    "n. 抱怨，投诉；疾病",
    "delight":      "n. 高兴，愉快；vt. 使高兴；vi. 感到高兴",
    "emotion":      "n. 情感，情绪；感动",
    "expo":         "n. 博览会，展览会（exposition 的缩写）",
    "fish":         "n. 鱼，鱼类；v. 钓鱼，捕鱼",
    "freezer":      "n. 冰箱，冷冻室，冷藏箱",
    "identity":     "n. 身份；一致，同一性；特性",
    "lake":         "n. 湖，湖泊",
    "lift":         "n. 电梯，升降机；搭便车；v. 举起，抬起，提升",
    "medicine":     "n. 药，医学，内科；vt. 用药物治疗",
    "mine":         "n. 矿，矿藏；地雷；pron. 我的；v. 开采，挖矿",
    "mouth":        "n. 嘴，口；河口；v. 装腔作势地说",
    "nought":       "n. 零；无（=naught）",
    "organiser":    "n. 组织者； organizer（英式拼写）",
    "powerpoint":   "n. PowerPoint 演示文稿（微软幻灯片软件）",
    "recruit":      "n. 新兵，新成员；v. 招募，征募，招收",
    "sail":         "n. 帆，篷；航行；v. 航行，起航，驾驶",
    "sound":        "n. 声音，声响；adj. 健全的，可靠的；v. 听起来，发出声音",
    "speed":        "n. 速度，快速；v. 加速，超速",
    "sunshield":    "n. 遮阳板，防晒遮光罩",
    "title":        "n. 标题，题目；头衔，称号；vt. 加标题于",
    # 与本次语料相关的专门含义（更贴合本书语境）
    "baldness":     "n. 秃头，脱发（指秃顶这一现象；bald 的名词形式）",
    # 派生 / 动名词：补 base 词义
    "advertising":  "n. 广告业，广告活动（advertise 的动名词形式）",
    "dining":       "n. 进餐，用餐（dine 的动名词形式）",
    "finding":      "n. 发现，调查结果（find 的动名词形式）",
    "handling":     "n. 处理，操作；搬运（handle 的动名词形式）",
    "planting":     "n. 种植，栽培（plant 的动名词形式）",
    "recording":    "n. 录音，录制；记录（record 的动名词形式）",
    "recorder":     "n. 录音机，记录员；竖笛（record 的派生名词）",
    "recycling":    "n. 回收利用，再循环（recycle 的动名词形式）",
    "smoking":      "n. 吸烟，抽烟（smoke 的动名词形式）",
    "starting":     "n. 开始，出发（start 的动名词形式）",
    "teaching":     "n. 教学，教导；教师职业（teach 的动名词形式）",
}

# 明确不应出现、或应丢弃的词（防止误补）
DENY = set()


def build_index(qsd):
    by_lower = collections.defaultdict(list)
    for w, v in qsd.items():
        by_lower[w.lower()].append((w, v))
    return by_lower


def _clean(mean, limit=60):
    m = re.sub(r"\s+", " ", (mean or "").strip())
    if len(m) > limit:
        m = m[:limit].rstrip() + "…"
    return m


def _exact(d, word):
    for cand in (word, word.lower(), word.capitalize(), word.upper()):
        if cand in d:
            v = d[cand]
            if _clean(v.get("mean")):
                return cand, v
    return None, None


def singular_candidates(w):
    out, lw = [], w.lower()
    if lw.endswith("ies") and len(lw) > 4:
        out.append(w[:-3] + "y")
    if lw.endswith("ves") and len(lw) > 4:
        out += [w[:-3] + "f", w[:-3] + "fe"]
    if lw.endswith("es") and len(lw) > 3:
        out += [w[:-2], w[:-1]]
    if lw.endswith("s") and not lw.endswith("ss") and len(lw) > 3:
        out.append(w[:-1])
    if lw.endswith("'s") or lw.endswith("\u2019s"):
        out.append(w[:-2])
    seen, res = set(), []
    for c in out:
        if c.lower() != lw and c.lower() not in seen:
            seen.add(c.lower()); res.append(c)
    return res


def derived_candidates(w):
    """-ing / -ed / -ness / -er / -tion 等派生回退"""
    out, lw = [], w.lower()
    if lw.endswith("ing") and len(lw) > 5:
        out += [w[:-3], w[:-3] + "e"]
        if len(w) > 6 and w[-4] == w[-5]:      # running -> run
            out.append(w[:-4])
    if lw.endswith("ed") and len(lw) > 4:
        out += [w[:-2], w[:-1], w[:-3]]
    if lw.endswith("ness") and len(lw) > 6:
        out.append(w[:-4])
    if lw.endswith("er") and len(lw) > 5:
        out += [w[:-2], w[:-1]]
    if lw.endswith("r") and lw.endswith("er") is False and len(lw) > 5 and lw[-2] == "e":
        out.append(w[:-1])
    if lw.endswith("tion") and len(lw) > 7:
        out.append(w[:-3])
    seen, res = set(), []
    for c in out:
        if c.lower() != lw and c.lower() not in seen and len(c) >= 3:
            seen.add(c.lower()); res.append(c)
    return res


def resolve(word, qsd, by_lower, curated=None):
    """返回 (释义, 音标, 来源标记, 音标是否借自变形)
    - 来源标记用于统计
    - 音标借自变形时（如 batteries 用 battery 的音标），调用方应加提示
    - 无法补全时返回 ('', '', 'MISS', False)
    """
    curated = curated if curated is not None else CURATED
    if word in DENY:
        return "", "", "DENY", False

    # 1. 精确
    hit, v = _exact(qsd, word)
    if hit:
        return _clean(v.get("mean")), (v.get("ipa") or "").strip(), "exact", False

    # 2. 去空格 / 连字符
    flat = word.replace(" ", "").replace("-", "")
    if flat != word:
        hit, v = _exact(qsd, flat)
        if hit:
            return _clean(v.get("mean")), (v.get("ipa") or "").strip(), "flat", False

    # 3. 单数化（复数 -> 单数，最主要的缺口）
    for c in singular_candidates(word):
        hit, v = _exact(qsd, c)
        if hit:
            return _clean(v.get("mean")), (v.get("ipa") or "").strip(), "singular:" + c, True

    # 4. 派生词还原
    for c in derived_candidates(word):
        hit, v = _exact(qsd, c)
        if hit:
            return _clean(v.get("mean")), (v.get("ipa") or "").strip(), "derived:" + c, True

    # 5. 复合词拆分
    parts = [p for p in re.split(r"[ \-]", word) if p]
    if len(parts) > 1:
        for p in parts:
            hit, v = _exact(qsd, p)
            if hit:
                return _clean(v.get("mean")), (v.get("ipa") or "").strip(), "part:" + p, True

    # 6. 参考表以该词为前缀且唯一的词条（仅对单数候选，避免误配）
    for c in singular_candidates(word):
        m = by_lower.get(c.lower())
        if m and len(m) == 1:
            w0, v0 = m[0]
            if _clean(v0.get("mean")):
                return _clean(v0.get("mean")), (v0.get("ipa") or "").strip(), "prefix:" + w0, True

    # 7. 人工补充（无音标，界面直接不显示音标）
    if word in curated:
        return _clean(curated[word], 80), "", "curated", False
    if word.lower() in curated:
        return _clean(curated[word.lower()], 80), "", "curated", False

    return "", "", "MISS", False
