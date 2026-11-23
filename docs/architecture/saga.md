# Order saga

The API commits `OrderPlaced` and the order in one transaction. The worker does two jobs on a short loop.

The relay locks unpublished outbox rows with `FOR UPDATE SKIP LOCKED`, publishes each one on a confirm channel, and only then sets `published_at`. If the broker publish throws, the transaction rolls back and the row stays unpublished.

The consumer handles the message inside a second transaction that inserts the inbox row. A conflict on `(consumer, message_id)` means this delivery already happened: the handler commits nothing else and the message is acked. A crash after the business write and before the ack is therefore safe.

`OrderPlaced` reserves stock, or emits `InventoryRejected` when the quantity does not fit. The process manager then moves the order to `reserved` and emits `CollectPayment`. The payment port captures or declines based on `paymentOutcome`. Capture writes a balanced journal and emits `PaymentCaptured`, and the order becomes `allocated`. Decline emits `PaymentFailed`, the order becomes `rejected`, and `ReleaseReservation` returns the stock.

A placed order older than the reservation timeout becomes `rejected` with reason `reservation_timeout`. If `InventoryReserved` arrives after that, the process manager emits `ReleaseReservation` instead of collecting payment.

A handler that throws is republished onto a retry queue with attempt 1, then 2. The third failure is nacked onto the dead-letter queue. The retry delays are 1s, 5s, and 15s.
