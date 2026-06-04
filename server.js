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

// ---- KST 기준 월 계산 유틸 (추가) ----
function getKstNow() {
  // KST = UTC+9
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function yyyyMmFromDateUTC(dateObj) {
  // KST로 보정한 Date를 UTC getter로 읽으면, KST 기준 YYYY-MM이 안정적으로 나옵니다.
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function addMonthsUTC(dateObj, deltaMonths) {
  const d = new Date(dateObj.getTime());
  d.setUTCDate(1); // 월말 이슈 방지
  d.setUTCMonth(d.getUTCMonth() + deltaMonths);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

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
  let ny = y,
    nm = m + 1;
  if (nm === 13) {
    nm = 1;
    ny = y + 1;
  }
  const endDt = toISODate(ny, nm, 1); // 다음달 1일
  return { startDt, endDt };
}

app.get("/popup", (req, res) => {
  res.sendFile(__dirname + "/public/popup.html");
});

/**
 * 실데이터: Data4Library loanItemSrch
 * 호출 예:
 *   /api/bestsellers?region=서울특별시&month=2026-05
 *
 * 정책(요청 반영):
 * - month가 없으면 '지난달'로 자동 처리
 * - '지난달까지만 제공': 이번달 이상(이번달/미래)이면 not_ready 메시지 반환
 * - 기준 시각: 한국시간(KST)
 */
app.get("/api/bestsellers", async (req, res) => {
  try {
    const regionName = String(req.query.region || "").trim();

    // month는 선택값: 없으면 지난달로 자동 세팅
    let month = String(req.query.month || "").trim(); // YYYY-MM

    if (!regionName) return res.status(400).json({ error: "region is required" });

    // KST 기준 이번달/지난달 계산
    const kstNow = getKstNow();
    const thisMonth = yyyyMmFromDateUTC(kstNow);
    const lastMonth = yyyyMmFromDateUTC(addMonthsUTC(kstNow, -1));

    if (!month) month = lastMonth;

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

    // '지난달까지만 제공' 정책: 이번달 이상이면 안내만 반환(Upstream 호출 안 함)
    if (month >= thisMonth) {
      return res.json({
        region: regionName,
        regionCode,
        month,
        status: "not_ready",
        message: "해당 월의 데이터는 아직 확정/제공되지 않습니다. 다음 달에 확인해주세요.",
        updatedAt: new Date().toISOString(),
        source: "data4library.loanItemSrch",
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

    const apiRes = await fetch(apiUrl, {
      headers: { Accept: "application/xml,text/xml,*/*" },
    });
    const xml = await apiRes.text();
    if (!apiRes.ok) {
      return res.status(502).json({
        error: "upstream error",
        status: apiRes.status,
        body: xml.slice(0, 500),
      });
    }

    const { XMLParser } = require("fast-xml-parser");
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);

    const responseRoot = parsed?.response || parsed;
    const rawDocs = responseRoot?.docs?.doc || [];
    const docs = Array.isArray(rawDocs) ? rawDocs : [rawDocs];

    const items = docs.filter(Boolean).map((d, idx) => ({
      rank: Number(d.no ?? idx + 1),
      title: d.bookname ?? "",
      authors: d.authors ?? "",
      publisher: d.publisher ?? "",
      isbn13: d.isbn13 ?? "",
      loanCnt: Number(d.loan_count ?? 0),
      kdcName: d.class_nm ?? "",
      bookImageURL: String(d.bookImageURL ?? "").trim(),
      bookDtlUrl: String(d.bookDtlUrl ?? "").trim(), // 앞 공백 제거
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
