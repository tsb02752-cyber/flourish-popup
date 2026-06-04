/**
 * server.js - 지역별 + (2026) 월별 Top10 전체(히트맵/막대용)
 *
 * 추가 엔드포인트:
 *   /api/monthly-top10?region=서울특별시
 *     -> 2026년 1~12월 Top10을 long format으로 반환 (최대 120 rows)
 *
 * deps:
 *   npm i express cors fast-xml-parser
 *
 * env:
 *   DATA4LIBRARY_AUTH_KEY=발급키
 */

const express = require("express");
const cors = require("cors");
const { XMLParser } = require("fast-xml-parser");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

const YEAR_FIXED = 2026;

const REGION_CODE_KR = {
  "서울": "11",
  "서울특별시": "11",

  "부산": "21",
  "부산광역시": "21",

  "대구": "22",
  "대구광역시": "22",

  "인천": "23",
  "인천광역시": "23",

  "광주": "24",
  "광주광역시": "24",

  "대전": "25",
  "대전광역시": "25",

  "울산": "26",
  "울산광역시": "26",

  "세종": "29",
  "세종특별자치시": "29",

  "경기": "31",
  "경기도": "31",

  "강원": "32",
  "강원도": "32",
  "강원특별자치도": "32",

  "충북": "33",
  "충청북도": "33",

  "충남": "34",
  "충청남도": "34",

  "전북": "35",
  "전라북도": "35",
  "전북특별자치도": "35",

  "전남": "36",
  "전라남도": "36",

  "경북": "37",
  "경상북도": "37",
  "걍북": "37",

  "경남": "38",
  "경상남도": "38",

  "제주": "39",
  "제주도": "39",
  "제주특별자치도": "39",
};

function normalizeRegionName(s) {
  return String(s || "").trim();
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function getMonthRange(yyyy, m) {
  // month: 1..12
  const end = new Date(Date.UTC(yyyy, m, 0)); // last day of month
  const startDt = `${yyyy}-${pad2(m)}-01`;
  const endDt = `${yyyy}-${pad2(m)}-${pad2(end.getUTCDate())}`;
  return { startDt, endDt };
}

async function fetchLoanTop10(regionCode, startDt, endDt) {
  const authKey = process.env.DATA4LIBRARY_AUTH_KEY;
  if (!authKey) throw new Error("missing DATA4LIBRARY_AUTH_KEY");

  const apiUrl =
    `http://data4library.kr/api/loanItemSrch` +
    `?authKey=${encodeURIComponent(authKey)}` +
    `&startDt=${encodeURIComponent(startDt)}` +
    `&endDt=${encodeURIComponent(endDt)}` +
    `&region=${encodeURIComponent(regionCode)}` +
    `&pageNo=1&pageSize=10`;

  const r = await fetch(apiUrl);
  const xml = await r.text();
  const parsed = parser.parse(xml);

  const docsRaw = parsed?.response?.docs?.doc || [];
  const docs = Array.isArray(docsRaw) ? docsRaw : docsRaw ? [docsRaw] : [];

  return docs.map((d, idx) => ({
    rank: idx + 1,
    bookname: d.bookname ?? "",
    authors: d.authors ?? "",
    publisher: d.publisher ?? "",
    publication_year: d.publication_year ?? "",
    isbn13: d.isbn13 ?? "",
    loan_count: Number(d.loan_count ?? 0) || 0,
  }));
}

/**
 * (NEW) 월별 Top10 전체: long format rows
 * - 행 단위: (region, month, rank, bookname, loan_count, ...)
 * - Flourish 히트맵/막대에 바로 쓰기 좋음
 */
app.get("/api/monthly-top10", async (req, res) => {
  try {
    const regionName = normalizeRegionName(req.query.region);
    if (!regionName) {
      return res.status(400).json({
        status: "error",
        error: "missing region",
        hint: "/api/monthly-top10?region=서울특별시",
      });
    }

    const regionCode = REGION_CODE_KR[regionName];
    if (!regionCode) {
      return res.status(400).json({
        status: "error",
        error: "unknown region name",
        receivedRegion: regionName,
      });
    }

    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const { startDt, endDt } = getMonthRange(YEAR_FIXED, m);
      const items = await fetchLoanTop10(regionCode, startDt, endDt);

      // 월별 Top10 -> 10행으로 펼치기
      for (const it of items) {
        rows.push({
          year: YEAR_FIXED,
          month: m, // 숫자형 월(1..12)
          month_label: `${m}월`, // Flourish 표시용
          region_name: regionName,
          region_code: regionCode,

          rank: it.rank, // 1..10
          bookname: it.bookname,
          authors: it.authors,
          publisher: it.publisher,
          publication_year: it.publication_year,
          isbn13: it.isbn13,
          loan_count: it.loan_count,
        });
      }

      // 어떤 달은 자료가 비거나 10권 미만일 수도 있음(그대로 둠)
    }

    return res.json({
      status: "ok",
      regionName,
      regionCode,
      yearFixed: YEAR_FIXED,
      rowCount: rows.length,
      rows,
    });
  } catch (e) {
    return res.status(500).json({ status: "error", error: String(e) });
  }
});

/** (기존) 단일 월 Top10 (팝업/테스트용) */
app.get("/api/bestsellers", async (req, res) => {
  try {
    const regionName = normalizeRegionName(req.query.region);
    const month = Number(String(req.query.month || "").trim());

    if (!regionName) return res.status(400).json({ status: "error", error: "missing region" });
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ status: "error", error: "invalid month (1..12)" });
    }

    const regionCode = REGION_CODE_KR[regionName];
    if (!regionCode) {
      return res.status(400).json({ status: "error", error: "unknown region name", receivedRegion: regionName });
    }

    const { startDt, endDt } = getMonthRange(YEAR_FIXED, month);
    const items = await fetchLoanTop10(regionCode, startDt, endDt);

    return res.json({
      status: "ok",
      yearFixed: YEAR_FIXED,
      regionName,
      regionCode,
      month,
      startDt,
      endDt,
      items,
    });
  } catch (e) {
    return res.status(500).json({ status: "error", error: String(e) });
  }
});

/** 간단 홈 */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    endpoints: [
      "/api/monthly-top10?region=서울특별시",
      "/api/bestsellers?region=서울특별시&month=5",
    ],
  });
});

app.listen(PORT, () => console.log("Server running on", PORT));
