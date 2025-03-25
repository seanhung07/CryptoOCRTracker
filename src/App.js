import React, { useState, useEffect, useRef } from "react";
import _ from "lodash";

const App = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cryptoData, setCryptoData] = useState([]);
  const [selectedCoin, setSelectedCoin] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [ocrData, setOcrData] = useState({
    marketBuyVolume: 0,
    marketSellVolume: 0,
    ocrValue: 0,
    ocrHistory: [],
    bids: 0,
    asks: 0,
    lastPrice: 0,
    signal: "",
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredCryptoData, setFilteredCryptoData] = useState([]);

  const webSocketRef = useRef(null);
  const intervalRef = useRef(null);

  // 獲取可用的加密貨幣合約
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const futuresResponse = await fetch(
          "https://fapi.binance.com/fapi/v1/exchangeInfo"
        );
        const futuresData = await futuresResponse.json();
        const symbols = futuresData.symbols
          .filter((symbol) => symbol.status === "TRADING")
          .map((symbol) => ({
            symbol: symbol.symbol,
            baseAsset: symbol.baseAsset,
            quoteAsset: symbol.quoteAsset,
          }));
        const groupedByBase = _.groupBy(symbols, "baseAsset");
        const processedData = Object.keys(groupedByBase).map((coin) => {
          const contracts = groupedByBase[coin];
          return {
            coin,
            contracts,
          };
        });

        setCryptoData(processedData);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching data:", error);
        setError("無法獲取可用合約，請稍後再試。");
        setLoading(false);
      }
    };

    fetchData();
  }, []);
  const handleCoinSelection = (coin) => {
    if (isAnalyzing) {
      stopAnalysis();
    }
    setSelectedCoin(coin);
  };
  const startAnalysis = () => {
    if (!selectedCoin || isAnalyzing) return;
    const coinData = cryptoData.find((item) => item.coin === selectedCoin);
    if (!coinData) return;

    const usdtPair = coinData.contracts.find((contract) =>
      contract.symbol.includes("USDT")
    );
    const selectedSymbol = usdtPair
      ? usdtPair.symbol
      : coinData.contracts[0].symbol;

    setIsAnalyzing(true);
    setOcrData({
      marketBuyVolume: 0,
      marketSellVolume: 0,
      ocrValue: 0,
      ocrHistory: [],
      bids: 0,
      asks: 0,
      lastPrice: 0,
      signal: "",
    });

    // 初始化WebSocket連接
    const wsSymbol = selectedSymbol.toLowerCase();
    const socket = `wss://stream.binance.com:9443/ws/${wsSymbol}@aggTrade`;
    const ws = new WebSocket(socket);

    ws.onopen = () => {
      console.log(`WebSocket connected for ${selectedSymbol}`);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const price = parseFloat(data.p);
      const qty = parseFloat(data.q);
      const isBuyerMaker = data.m;

      setOcrData((prevData) => {
        let newMarketBuyVolume = prevData.marketBuyVolume;
        let newMarketSellVolume = prevData.marketSellVolume;

        if (isBuyerMaker) {
          newMarketSellVolume += qty;
        } else {
          newMarketBuyVolume += qty;
        }
        const totalVolume = newMarketBuyVolume + newMarketSellVolume;
        const ocrValue =
          totalVolume > 0
            ? (newMarketBuyVolume - newMarketSellVolume) / totalVolume
            : 0;
        const newOcrHistory = [...prevData.ocrHistory, ocrValue];
        if (newOcrHistory.length > 50) {
          // 保留最後50個值
          newOcrHistory.shift();
        }

        return {
          ...prevData,
          marketBuyVolume: newMarketBuyVolume,
          marketSellVolume: newMarketSellVolume,
          ocrValue,
          ocrHistory: newOcrHistory,
          lastPrice: price,
        };
      });
    };

    ws.onerror = (error) => {
      console.error(`WebSocket error: ${error}`);
      setError(`WebSocket連接錯誤，請重試。`);
      setIsAnalyzing(false);
    };

    ws.onclose = () => {
      console.log(`WebSocket connection closed for ${selectedSymbol}`);
    };

    webSocketRef.current = ws;
    intervalRef.current = setInterval(async () => {
      try {
        const orderbookResponse = await fetch(
          `https://fapi.binance.com/fapi/v1/depth?symbol=${selectedSymbol}&limit=10`
        );
        const orderbookData = await orderbookResponse.json();

        const bids = orderbookData.bids.reduce(
          (sum, bid) => sum + parseFloat(bid[1]),
          0
        );
        const asks = orderbookData.asks.reduce(
          (sum, ask) => sum + parseFloat(ask[1]),
          0
        );

        setOcrData((prevData) => {
          // 根據OCR和訂單簿確定信號
          let signal = "觀察中...";

          if (prevData.ocrValue > 0.7 && asks < bids * 0.8) {
            signal = "買入訊號: OCR高，賣單減少";
          } else if (prevData.ocrValue < -0.7 && bids < asks * 0.8) {
            signal = "賣出訊號: OCR低，買單減少";
          }

          return {
            ...prevData,
            bids,
            asks,
            signal,
          };
        });
      } catch (error) {
        console.error(`Error fetching orderbook: ${error}`);
      }
    }, 2000);
  };
  const stopAnalysis = () => {
    if (webSocketRef.current) {
      webSocketRef.current.close();
      webSocketRef.current = null;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setIsAnalyzing(false);
  };
  useEffect(() => {
    return () => {
      if (webSocketRef.current) {
        webSocketRef.current.close();
      }

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100">
        <div className="text-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-3">載入加密貨幣資料中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100">
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="container py-4">
      <h1 className="mb-4">加密貨幣 OCR 分析工具</h1>

      <div className="row">
        <div className="col-md-4 mb-4">
          <div className="card">
            <div className="card-header">
              <h5 className="card-title mb-0">選擇幣種</h5>
            </div>
            <div className="card-body">
              <div className="mb-3">
                <input
                  type="text"
                  className="form-control"
                  placeholder="搜索幣種..."
                  value={searchTerm}
                  onChange={(e) => {
                    const term = e.target.value.toLowerCase();
                    setSearchTerm(term);

                    if (term === "") {
                      setFilteredCryptoData(cryptoData);
                    } else {
                      const filtered = cryptoData.filter((item) =>
                        item.coin.toLowerCase().includes(term)
                      );
                      setFilteredCryptoData(filtered);
                    }
                  }}
                />
              </div>

              <div style={{ height: "400px", overflowY: "auto" }}>
                {(searchTerm ? filteredCryptoData : cryptoData).map((item) => (
                  <div
                    key={item.coin}
                    onClick={() => handleCoinSelection(item.coin)}
                    className={`card mb-2 ${
                      selectedCoin === item.coin ? "border-primary" : ""
                    }`}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="card-body py-2 px-3">
                      <h6 className="card-title mb-1">{item.coin}</h6>
                      <p className="card-text small text-muted mb-0">
                        {item.contracts.length} 個合約
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3">
                {!isAnalyzing ? (
                  <button
                    onClick={startAnalysis}
                    disabled={!selectedCoin}
                    className={`btn ${
                      selectedCoin ? "btn-success" : "btn-secondary"
                    } w-100`}
                  >
                    開始分析 {selectedCoin && `(${selectedCoin})`}
                  </button>
                ) : (
                  <button
                    onClick={stopAnalysis}
                    className="btn btn-danger w-100"
                  >
                    停止分析
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="col-md-8">
          {isAnalyzing ? (
            <div className="card">
              <div className="card-header">
                <h5 className="card-title mb-0">{selectedCoin} OCR 分析</h5>
              </div>
              <div className="card-body">
                <div className="row mb-4">
                  <div className="col-md-4 mb-3">
                    <div className="card bg-light">
                      <div className="card-body p-3">
                        <h6 className="card-subtitle mb-1 text-muted small">
                          最新價格
                        </h6>
                        <h4 className="card-title mb-0">
                          {ocrData.lastPrice.toFixed(4)}
                        </h4>
                      </div>
                    </div>
                  </div>

                  <div className="col-md-4 mb-3">
                    <div className="card bg-light">
                      <div className="card-body p-3">
                        <h6 className="card-subtitle mb-1 text-muted small">
                          OCR 值
                        </h6>
                        <h4
                          className={`card-title mb-0 ${
                            ocrData.ocrValue > 0.3
                              ? "text-success"
                              : ocrData.ocrValue < -0.3
                              ? "text-danger"
                              : "text-primary"
                          }`}
                        >
                          {ocrData.ocrValue.toFixed(4)}
                        </h4>
                      </div>
                    </div>
                  </div>

                  <div className="col-md-4 mb-3">
                    <div className="card bg-light">
                      <div className="card-body p-3">
                        <h6 className="card-subtitle mb-1 text-muted small">
                          訊號
                        </h6>
                        <h5
                          className={`card-title mb-0 ${
                            ocrData.signal.includes("買入")
                              ? "text-success"
                              : ocrData.signal.includes("賣出")
                              ? "text-danger"
                              : "text-primary"
                          }`}
                        >
                          {ocrData.signal}
                        </h5>
                      </div>
                    </div>
                  </div>

                  <div className="col-md-6 mb-3">
                    <div className="card bg-light">
                      <div className="card-body p-3">
                        <h6 className="card-subtitle mb-1 text-muted small">
                          買單總量
                        </h6>
                        <h4 className="card-title mb-0 text-success">
                          {ocrData.marketBuyVolume.toFixed(2)}
                        </h4>
                      </div>
                    </div>
                  </div>

                  <div className="col-md-6 mb-3">
                    <div className="card bg-light">
                      <div className="card-body p-3">
                        <h6 className="card-subtitle mb-1 text-muted small">
                          賣單總量
                        </h6>
                        <h4 className="card-title mb-0 text-danger">
                          {ocrData.marketSellVolume.toFixed(2)}
                        </h4>
                      </div>
                    </div>
                  </div>

                  <div className="col-md-6 mb-3">
                    <div className="card bg-light">
                      <div className="card-body p-3">
                        <h6 className="card-subtitle mb-1 text-muted small">
                          買單深度
                        </h6>
                        <h4 className="card-title mb-0 text-success">
                          {ocrData.bids.toFixed(2)}
                        </h4>
                      </div>
                    </div>
                  </div>

                  <div className="col-md-6 mb-3">
                    <div className="card bg-light">
                      <div className="card-body p-3">
                        <h6 className="card-subtitle mb-1 text-muted small">
                          賣單深度
                        </h6>
                        <h4 className="card-title mb-0 text-danger">
                          {ocrData.asks.toFixed(2)}
                        </h4>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card mb-4">
                  <div className="card-header">
                    <h6 className="mb-0">OCR 歷史趨勢</h6>
                  </div>
                  <div className="card-body">
                    <div
                      style={{
                        height: "120px",
                        display: "flex",
                        alignItems: "flex-end",
                      }}
                    >
                      {ocrData.ocrHistory.map((value, index) => {
                        const height = Math.abs(value) * 100;
                        const maxHeight = 100;
                        const actualHeight = Math.min(height, maxHeight);

                        return (
                          <div
                            key={index}
                            style={{
                              flex: 1,
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "flex-end",
                              alignItems: "center",
                              margin: "0 1px",
                            }}
                          >
                            <div
                              style={{
                                width: "100%",
                                height: `${actualHeight}%`,
                                backgroundColor:
                                  value >= 0 ? "#198754" : "#dc3545",
                              }}
                            ></div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <p className="text-muted small">
                  資料即時更新中。最後更新時間:{" "}
                  {new Date().toLocaleTimeString()}
                </p>
              </div>
            </div>
          ) : (
            <div className="card h-100">
              <div className="card-body d-flex flex-column justify-content-center align-items-center py-5">
                <div className="display-1 text-muted mb-4">📊</div>
                <h3 className="mb-2">請選擇幣種並開始分析</h3>
                <p className="text-muted">
                  從左側選單選擇一個加密貨幣，然後點擊「開始分析」按鈕
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
