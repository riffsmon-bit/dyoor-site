import { ImageResponse } from "next/og";

import { blueprintShareParamsFromRequest, normalizedBlueprintSelection } from "@/lib/blueprintShare";

export const dynamic = "force-dynamic";
export const runtime = "edge";

function cardTitle(params: Record<string, string | boolean>) {
  if (params.saved && params.blueprintId) return String(params.blueprintId);
  return "DYOOR Blueprint";
}

function cardSubtitle(params: Record<string, string | boolean>, traitCount: number) {
  if (params.saved && params.rank) return `Saved Blueprint #${params.rank}`;
  return `${traitCount} selected trait${traitCount === 1 ? "" : "s"}`;
}

export async function GET(request: Request) {
  const params = blueprintShareParamsFromRequest(request);
  const selection = normalizedBlueprintSelection(params);
  const title = cardTitle(params);
  const subtitle = cardSubtitle(params, selection.length);
  const rows = selection.length
    ? selection.slice(0, 8)
    : [{ key: "Status", value: "Blueprint preview" }];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "linear-gradient(135deg, #070a12 0%, #0b1220 48%, #120a20 100%)",
          color: "#ffffff",
          fontFamily: "Arial, Helvetica, sans-serif",
          padding: 48,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            border: "2px solid rgba(91, 255, 223, 0.28)",
            background: "rgba(255, 255, 255, 0.035)",
            boxShadow: "0 0 80px rgba(91, 255, 223, 0.16)",
            padding: 34,
          }}
        >
          <div
            style={{
              width: 470,
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              paddingRight: 36,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  color: "#5bffdf",
                  fontSize: 20,
                  fontWeight: 900,
                  letterSpacing: 4,
                  textTransform: "uppercase",
                }}
              >
                DYOOR Ascension
              </div>
              <div
                style={{
                  display: "flex",
                  color: "#ffffff",
                  fontSize: 66,
                  fontWeight: 900,
                  lineHeight: 0.96,
                  marginTop: 28,
                }}
              >
                {title}
              </div>
              <div
                style={{
                  display: "flex",
                  color: "rgba(255, 255, 255, 0.72)",
                  fontSize: 25,
                  fontWeight: 800,
                  marginTop: 24,
                }}
              >
                {subtitle}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                color: "rgba(255, 255, 255, 0.68)",
                fontSize: 22,
                lineHeight: 1.35,
              }}
            >
              <span>Shareable blueprint card</span>
              <span style={{ color: "#5bffdf", marginTop: 8 }}>dyoor.fun</span>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              height: "100%",
              display: "flex",
              flexDirection: "column",
              background: "rgba(0, 0, 0, 0.26)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              padding: 26,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid rgba(255, 255, 255, 0.12)",
                paddingBottom: 18,
                marginBottom: 22,
              }}
            >
              <div
                style={{
                  display: "flex",
                  color: "#5bffdf",
                  fontSize: 20,
                  fontWeight: 900,
                  letterSpacing: 4,
                  textTransform: "uppercase",
                }}
              >
                Blueprint Traits
              </div>
              <div style={{ display: "flex", color: "#ffffff", fontSize: 24, fontWeight: 900 }}>
                {selection.length || 0}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column" }}>
              {rows.map((item, index) => (
                <div
                  key={`${item.key}-${index}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    minHeight: 44,
                    border: "1px solid rgba(255, 255, 255, 0.10)",
                    background: index % 2 === 0 ? "rgba(91, 255, 223, 0.06)" : "rgba(255, 255, 255, 0.04)",
                    marginBottom: 12,
                    padding: "0 18px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      width: 170,
                      color: "#5bffdf",
                      fontSize: 18,
                      fontWeight: 900,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                    }}
                  >
                    {item.key}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flex: 1,
                      color: "#ffffff",
                      fontSize: 22,
                      fontWeight: 800,
                    }}
                  >
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "cache-control": "public, max-age=300",
      },
    },
  );
}
