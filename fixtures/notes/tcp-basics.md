# Networks — Week 4: TCP basics

## Why TCP?

IP delivers packets on a **best-effort** basis: packets can be lost, duplicated or reordered. TCP builds a _reliable, ordered byte stream_ on top of IP.

## Connection setup: the three-way handshake

1. Client → server: `SYN` with an initial sequence number (ISN).
2. Server → client: `SYN-ACK`, acknowledging the client's ISN and sending its own.
3. Client → server: `ACK`.

Both sides now agree on starting sequence numbers.

## Reliability

- Every byte has a **sequence number**.
- The receiver sends **cumulative ACKs**: "I have everything up to byte _n_".
- The sender retransmits after a **timeout** or after three duplicate ACKs (_fast retransmit_).

## Flow control vs. congestion control

| Mechanism          | Protects     | Signal                         |
| ------------------ | ------------ | ------------------------------ |
| Flow control       | The receiver | Advertised window (`rwnd`)     |
| Congestion control | The network  | Loss or delay → `cwnd` shrinks |

Slow start doubles `cwnd` each round trip until loss or `ssthresh`; then congestion avoidance grows it by about one segment per round trip (AIMD).

## Teardown

Each side sends `FIN` and waits for an `ACK`, so closing takes four segments. The side that closes first waits in `TIME_WAIT` for 2 × MSL.
