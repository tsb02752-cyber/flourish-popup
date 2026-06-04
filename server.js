const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.static("public"));

const REGION_CODE_KR = {
  "서울특별시": "11",
  "부산광역시": "26",
  "대구광역시": "27",
  "인천광역시": "28",
  "광주광역시": "29",
  "대전광역시": "30",
  "울산광역시": "31",
  "세종특별자치시": "36",
  "경기도": "41",
  "강원도": "42",
  "강원특별자치도": "42",
  "충청북도": "43",
  "충청남도": "44",
  "전북특별자치도": "45",
  "전라북도": "45",
  "전라남도": "46",
  "경상북도": "47",
  "경상남도": "48",
  "제주특별자치도": "50",
  "제주도": "50",
};

function parseYYYYMM(yyyymm) {
  if (!/^\d{4}-\d{2}$/.test(yyyymm)) return null;
  const [y, m] = yyyymm.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  return { y, m };
}

function toISODate(y, m, d) {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function monthRange(yyyymm) {
  const p = parseYYYYMM(yyyymm);
  if (!p) return null;
  const { y, m } = p;
  const startDt = toISODate(y, m, 1);
  let ny = y, nm = m + 1;
  if (nm === 13) { nm = 1; ny = y + 1; }
  const endDt = toISODate(ny, nm, 1); // 다음달 1일 (API는 endDt 포함 처리여도 큰 문제 없음)
  return { startDt, endDt };
}

app.get("/popup", (req, res) => {
  res.sendFile(__dirname + "/public/popup.html");
});

/**
 * 실데이터: Data4Library loanItemSrch
 * 호출 예:
 *   /api/bestsellers?region=서울특별시&month=2026-05
 */
app.get("/api/bestsellers", async (req, res) => {
  try {
    const regionName = String(req.query.region || "").trim();
    const month = String(req.query.month || "").trim(); // YYYY-MM

    if (!regionName) return res.status(400).json({ error: "region is required" });
    if (!month) return res.status(400).json({ error: "month is required (YYYY-MM)" });

    const range = monthRange(month);
    if (!range) return res.status(400).json({ error: "month format invalid (YYYY-MM)" });

    const regionCode = REGION_CODE_KR[regionName];
    if (!regionCode) {
      return res.status(400).json({
        error: "unknown region name",
        received: regionName,
        hint: "REGION_CODE_KR에 있는 한글 시도명과 Flourish 값이 100% 일치해야 합니다.",
      });
    }

    const authKey = process.env.DATA4LIBRARY_AUTH_KEY;
    if (!authKey) {
      return res.status(500).json({
        error: "missing auth key",
        hint: "Render 환경변수 DATA4LIBRARY_AUTH_KEY 설정 필요",
      });
    }

    const apiUrl =
      `http://data4library.kr/api/loanItemSrch` +
      `?authKey=${encodeURIComponent(authKey)}` +
      `&startDt=${encodeURIComponent(range.startDt)}` +
      `&endDt=${encodeURIComponent(range.endDt)}` +
      `&region=${encodeURIComponent(regionCode)}` +
      `&pageNo=1&pageSize=10`;

    const apiRes = await fetch(apiUrl, { headers: { "Accept": "application/xml,text/xml,*/*" } });
    const xml = await apiRes.text();
    if (!apiRes.ok) {
      return res.status(502).json({ error: "upstream error", status: apiRes.status, body: xml.slice(0, 500) });
    }

    const { XMLParser } = require("fast-xml-parser");
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);

    const responseRoot = parsed?.response || parsed;
    const rawDocs = responseRoot?.docs?.doc || [];
    const docs = Array.isArray(rawDocs) ? rawDocs : [rawDocs];

    const items = docs.filter(Boolean).map((d, idx) => ({
      rank: Number(d.no ?? (idx + 1)),
      title: d.bookname ?? "",
      authors: d.authors ?? "",
      publisher: d.publisher ?? "",
      isbn13: d.isbn13 ?? "",
      loanCnt: Number(d.loan_count ?? 0),
      kdcName: d.class_nm ?? "",
      bookImageURL: d.bookImageURL ?? "",
      bookDtlUrl: d.bookDtlUrl ?? "",
    }));

    return res.json({
      region: regionName,
      regionCode,
      month,
      startDt: range.startDt,
      endDt: range.endDt,
      items,
      updatedAt: new Date().toISOString(),
      source: "data4library.loanItemSrch",
    });
  } catch (e) {
    return res.status(500).json({ error: "server error", message: e?.message || String(e) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on ${port}`));
