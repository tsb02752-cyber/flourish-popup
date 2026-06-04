/**
 * server.js (Full paste)
 * - Express proxy for Data4Library loanItemSrch
 * - 2026년 고정, 월별(1~12)
 * - KST 기준 "지난달까지"만 조회 허용 (그 이후: status=not_ready, message="공개 예정")
 * - Flourish popup: /popup?region={{name}}&month={{month}}
 *
 * Required ENV:
 * - DATA4LIBRARY_AUTH_KEY=xxxxxxxxxxxxxxxx
 *
 * Install deps:
 *   npm i express cors fast-xml-parser
 * Node 18+ recommended (global fetch available).
 */

const express = require("express");
const cors = require("cors");
const { XMLParser } = require("fast-xml-parser");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

/** =========================
 *  1) Region code dictionary
 *  - keys MUST match Flourish {{name}} exactly (Label/Name)
 *  ========================= */
const REGION_CODE_KR = {
  "서울특별시": "11",
  "부산광역시": "21",
  "대구광역시": "22",
  "인천광역시": "23",
  "광주광역시": "24",
  "대전광역시": "25",
  "울산광역시": "26",
  "세종특별자치시": "29",
  "경기도": "31",
  "강원특별자치도": "32", // (구 강원도)
  "충청북도": "33",
  "충청남도": "34",
  "전라남도": "36",
  "전북특별자치도": "35", // (구 전라북도)
  "경상북도": "37",
  "경상남도": "38",
  "제주특별자치도": "39",
};

/** =========================
 *  2) Utilities (KST / dates)
 *  ========================= */
function pad2(n) {
  return String(n).padStart(2, "0");
}

function getKstNow() {
  // Convert "now" to a Date object that represents KST time (by shifting milliseconds)
  const now = new Date();
  return new Date(now.getTime() + 9 * 60 * 60 * 1000);
}

/**
 * KST 기준 "이번 달"은 아직 집계 미완료로 보고, "지난달(YYYY-MM)"까지만 조회 가능
 * e.g., 2026-06-04(KST) -> lastReady = "2026-05"
 */
function getLastReadyYyyyMm() {
  const kst = getKstNow();
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1; // 1..12 (KST shifted, read via UTC getters)

  let yy = y;
  let mm = m - 1;
  if (mm === 0) {
    yy -= 1;
    mm = 12;
  }
  return `${yy}-${pad2(mm)}`;
}

/**
 * Given yyyyMm like "2026-05" -> {startDt:"2026-05-01", endDt:"2026-05-31"}
 */
function monthRangeFromYyyyMm(yyyyMm) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const startDt = `${y}-${pad2(m)}-01`;

  // last day of month: Date.UTC(y, m, 0) where m is 1..12 -> next month "0th day"
  const end = new Date(Date.UTC(y, m, 0));
  const endDt = `${y}-${pad2(m)}-${pad2(end.getUTCDate())}`;

  return { startDt, endDt };
}

/** =========================
 *  3) XML Parser
 *  ========================= */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

/** =========================
 *  4) API: /api/bestsellers
 *  - region: Korean name (e.g., "서울특별시")
 *  - month: 1..12
 *  - year is fixed to 2026
 *  ========================= */
app.get("/api/bestsellers", async (req, res) => {
  try {
    const regionName = String(req.query.region || "").trim();
    const monthRaw = String(req.query.month || "").trim();

    if (!regionName) {
      return res.status(400).json({ error: "region is required" });
    }

    const regionCode = REGION_CODE_KR[regionName];
    if (!regionCode) {
      return res.status(400).json({
        error: "unknown region",
        receivedRegion: regionName,
        hint: "Flourish {{name}} must exactly match a key in REGION_CODE_KR",
      });
    }

    const monthNum = Number(monthRaw);
    if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({
        error: "month must be integer 1~12",
        receivedMonth: monthRaw,
      });
    }

    const YEAR_FIXED = 2026;
    const yyyyMm = `${YEAR_FIXED}-${pad2(monthNum)}`;

    const lastReady = getLastReadyYyyyMm();

    // If requested month is later than lastReady -> not_ready
    if (yyyyMm > lastReady) {
      return res.status(200).json({
        status: "not_ready",
        message: "공개 예정",
        region: regionName,
        regionCode,
        yyyyMm,
        lastReady,
        items: [],
      });
    }

    const { startDt, endDt } = monthRangeFromYyyyMm(yyyyMm);

    const authKey = process.env.DATA4LIBRARY_AUTH_KEY;
    if (!authKey) {
      return res.status(500).json({ error: "missing DATA4LIBRARY_AUTH_KEY" });
    }

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

    // Data4Library typical structure:
    // response -> docs -> doc (array or object)
    const docsRaw = parsed?.response?.docs?.doc || [];
    const docs = Array.isArray(docsRaw) ? docsRaw : docsRaw ? [docsRaw] : [];

    const items = docs.map((d, idx) => ({
      rank: idx + 1,
      bookname: d.bookname ?? "",
      authors: d.authors ?? "",
      publisher: d.publisher ?? "",
      publication_year: d.publication_year ?? "",
      isbn13: d.isbn13 ?? "",
      loan_count: d.loan_count ?? "",
      bookImageURL: d.bookImageURL ?? "",
      bookDtlUrl: d.bookDtlUrl ?? "",
    }));

    return res.status(200).json({
      status: "ok",
      region: regionName,
      regionCode,
      yyyyMm,
      startDt,
      endDt,
      items,
    });
  } catch (e) {
    return res.status(500).json({
      error: "server error",
      detail: String(e),
    });
  }
});

/** =========================
 *  5) Popup page: /popup
 *  - expects query: region, month
 *  - fetches /api/bestsellers and renders list or "공개 예정"
 *  ========================= */
app.get("/popup", (req, res) => {
  // Minimal HTML (inline CSS/JS) for Flourish iframe
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>월별 대출 Top10</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans KR", Arial, sans-serif; }
    .wrap { padding: 12px 14px; }
    .title { font-size: 15px; font-weight: 700; margin: 0 0 10px; }
    .sub { font-size: 12px; opacity: 0.7; margin: 0 0 12px; }
    .card { border: 1px solid #e6e6e6; border-radius: 10px; padding: 10px 12px; margin: 8px 0; }
    .book { font-size: 13px; font-weight: 700; margin: 0 0 6px; line-height: 1.35; }
    .meta { font-size: 12px; opacity: 0.75; line-height: 1.35; }
    .msg { border: 1px dashed #cfcfcf; border-radius: 10px; padding: 14px 12px; background: #fafafa; }
    .err { border: 1px solid #ffd0d0; background: #fff5f5; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1 class="title" id="title">불러오는 중...</h1>
    <p class="sub" id="sub"></p>
    <div id="content"></div>
  </div>

  <script>
    (function () {
      const params = new URLSearchParams(location.search);
      const region = (params.get("region") || "").trim();
      const month = (params.get("month") || "").trim();

      const titleEl = document.getElementById("title");
      const subEl = document.getElementById("sub");
      const contentEl = document.getElementById("content");

      if (!region || !month) {
        titleEl.textContent = "잘못된 요청";
        contentEl.innerHTML = '<div class="msg err">region / month 파라미터가 필요합니다.</div>';
        return;
      }

      titleEl.textContent = region + " - 2026년 " + month + "월 대출 Top10";
      subEl.textContent = "기준: KST 지난달까지 공개 (이번달~미래월: 공개 예정)";

      const url = "/api/bestsellers?region=" + encodeURIComponent(region) + "&month=" + encodeURIComponent(month);

      fetch(url)
        .then(r => r.json())
        .then(data => {
          if (data.status === "not_ready") {
            contentEl.innerHTML = '<div class="msg"><strong>' + (data.message || "공개 예정") + '</strong></div>';
            return;
          }

          if (data.status !== "ok") {
            contentEl.innerHTML = '<div class="msg err"><strong>데이터를 불러오지 못했습니다.</strong></div>';
            return;
          }

          if (!data.items || data.items.length === 0) {
            contentEl.innerHTML = '<div class="msg">결과가 없습니다.</div>';
            return;
          }

          const html = data.items.map(item => {
            const metaParts = [];
            if (item.authors) metaParts.push(item.authors);
            if (item.publisher) metaParts.push(item.publisher);
            if (item.publication_year) metaParts.push(item.publication_year);

            return (
              '<div class="card">' +
                '<div class="book">' + item.rank + ". " + (item.bookname || "") + '</div>' +
                '<div class="meta">' + metaParts.join(" · ") + '</div>' +
              '</div>'
            );
          }).join("");

          contentEl.innerHTML = html;
        })
        .catch(err => {
          contentEl.innerHTML = '<div class="msg err"><strong>오류가 발생했습니다.</strong></div>';
        });
    })();
  </script>
</body>
</html>`);
});

/** =========================
 *  6) Health check
 *  ========================= */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "data4library-proxy",
    endpoints: ["/popup?region=서울특별시&month=5", "/api/bestsellers?region=서울특별시&month=5"],
    yearFixed: 2026,
    lastReadyExample: getLastReadyYyyyMm(),
  });
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
