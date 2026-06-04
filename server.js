/**
 * server.js - Flourish 클릭 지역별(시/도) 2026 연간 Top10
 * - /popup?region={{name}} 로 호출되면, 내부에서 region명을 코드로 매핑해 API 호출
 *
 * deps:
 *   npm i express cors fast-xml-parser
 * run:
 *   node server.js
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
const START_DT = `${YEAR_FIXED}-01-01`;
const END_DT = `${YEAR_FIXED}-12-31`;

/**
 * Flourish의 {{name}}(시도명)가 어떤 문자열로 들어오는지에 따라
 * 키를 더 추가/수정해야 합니다.
 *
 * - "강원"은 보통 "강원특별자치도"로 들어올 수 있음
 * - "경북" 오타: 사용자가 "걍북"이라고 적었는데 실제는 "경상북도"/"경북"
 * - "세종"은 "세종특별자치시"
 */
const REGION_CODE_KR = {
  // 특별/광역시
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

  // 도
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
  "걍북": "37", // 혹시 Flourish 데이터에 오타가 섞였을 경우 안전장치

  "경남": "38",
  "경상남도": "38",

  "제주": "39",
  "제주도": "39",
  "제주특별자치도": "39",
};

function normalizeRegionName(s) {
  return String(s || "").trim();
}

/** API 호출 (지역코드 필수) */
async function fetchLoanTop10ByRegionCode(regionCode) {
  const authKey = process.env.DATA4LIBRARY_AUTH_KEY;
  if (!authKey) throw new Error("missing DATA4LIBRARY_AUTH_KEY");

  const apiUrl =
    `http://data4library.kr/api/loanItemSrch` +
    `?authKey=${encodeURIComponent(authKey)}` +
    `&startDt=${encodeURIComponent(START_DT)}` +
    `&endDt=${encodeURIComponent(END_DT)}` +
    `&region=${encodeURIComponent(regionCode)}` +
    `&pageNo=1&pageSize=10`;

  const r = await fetch(apiUrl);
  const xml = await r.text();
  const parsed = parser.parse(xml);

  // docs.doc가 단일 객체/배열 모두 가능
  const docsRaw = parsed?.response?.docs?.doc || [];
  const docs = Array.isArray(docsRaw) ? docsRaw : docsRaw ? [docsRaw] : [];

  return docs.map((d, idx) => ({
    rank: idx + 1,
    bookname: d.bookname ?? "",
    authors: d.authors ?? "",
    publisher: d.publisher ?? "",
    publication_year: d.publication_year ?? "",
    isbn13: d.isbn13 ?? "",
    loan_count: d.loan_count ?? "",
    // 필요시 사용
    bookImageURL: d.bookImageURL ?? "",
    bookDtlUrl: d.bookDtlUrl ?? "",
  }));
}

/** JSON API: Flourish/디버깅용 */
app.get("/api/bestsellers", async (req, res) => {
  try {
    const regionName = normalizeRegionName(req.query.region);
    const regionCode = REGION_CODE_KR[regionName];

    if (!regionName) {
      return res.status(400).json({
        status: "error",
        error: "missing region query",
        hint: "use /api/bestsellers?region=서울특별시",
      });
    }

    if (!regionCode) {
      return res.status(400).json({
        status: "error",
        error: "unknown region name",
        receivedRegion: regionName,
        hint: "REGION_CODE_KR에 Flourish의 실제 {{name}} 문자열을 추가하세요.",
      });
    }

    const items = await fetchLoanTop10ByRegionCode(regionCode);

    return res.json({
      status: "ok",
      yearFixed: YEAR_FIXED,
      startDt: START_DT,
      endDt: END_DT,
      regionName,
      regionCode,
      items,
    });
  } catch (e) {
    return res.status(500).json({ status: "error", error: String(e) });
  }
});

/** Popup HTML: Flourish에서 iframe으로 넣는 페이지 */
app.get("/popup", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  res.send(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>지역별 대출 Top10</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans KR", Arial, sans-serif; }
    .wrap { padding: 12px 14px; }
    .title { font-size: 15px; font-weight: 800; margin: 0 0 8px; }
    .sub { font-size: 12px; opacity: .7; margin: 0 0 12px; }
    .card { border: 1px solid #e8e8e8; border-radius: 10px; padding: 10px 12px; margin: 8px 0; }
    .book { font-size: 13px; font-weight: 700; margin: 0 0 6px; line-height: 1.35; }
    .meta { font-size: 12px; opacity: 0.75; line-height: 1.35; }
    .msg { border: 1px dashed #cfcfcf; border-radius: 10px; padding: 14px 12px; background: #fafafa; }
    .err { border: 1px solid #ffd0d0; background: #fff5f5; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="title" id="title">불러오는 중...</div>
    <div class="sub" id="sub"></div>
    <div id="content"></div>
  </div>

  <script>
    (function () {
      const params = new URLSearchParams(location.search);
      const region = (params.get("region") || "").trim();

      const titleEl = document.getElementById("title");
      const subEl = document.getElementById("sub");
      const contentEl = document.getElementById("content");

      titleEl.textContent = (region || "지역 미지정") + " · 2026 연간 대출 Top10";
      subEl.textContent = "기간: ${START_DT} ~ ${END_DT}";

      if (!region) {
        contentEl.innerHTML = '<div class="msg err"><strong>region 파라미터가 없습니다.</strong><br/>예: /popup?region=서울특별시</div>';
        return;
      }

      fetch("/api/bestsellers?region=" + encodeURIComponent(region))
        .then(r => r.json())
        .then(data => {
          if (data.status !== "ok") {
            contentEl.innerHTML =
              '<div class="msg err"><strong>데이터 오류</strong><br/>' +
              (data.error ? String(data.error) : "unknown") +
              (data.receivedRegion ? "<br/>received: " + data.receivedRegion : "") +
              "</div>";
            return;
          }

          const items = data.items || [];
          if (!items.length) {
            contentEl.innerHTML = '<div class="msg">결과가 없습니다.</div>';
            return;
          }

          const html = items.map(item => {
            const meta = [item.authors, item.publisher, item.publication_year].filter(Boolean).join(" · ");
            return (
              '<div class="card">' +
                '<div class="book">' + item.rank + ". " + (item.bookname || "") + '</div>' +
                '<div class="meta">' + meta + '</div>' +
              '</div>'
            );
          }).join("");

          contentEl.innerHTML = html;
        })
        .catch(err => {
          contentEl.innerHTML = '<div class="msg err"><strong>통신 오류</strong><br/>' + String(err) + '</div>';
        });
    })();
  </script>
</body>
</html>`);
});

/** Health */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    endpoints: [
      "/popup?region=서울특별시",
      "/api/bestsellers?region=서울특별시",
    ],
    yearFixed: YEAR_FIXED,
    startDt: START_DT,
    endDt: END_DT,
  });
});

app.listen(PORT, () => console.log("Server running on", PORT));
