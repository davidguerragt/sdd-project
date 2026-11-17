CREATE TABLE IF NOT EXISTS test_wallet_fundings (
  id CHAR(36) NOT NULL PRIMARY KEY,
  actor_id CHAR(36) NOT NULL,
  wallet_id CHAR(36) NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  balance_after DECIMAL(18,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'GTQ',
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  request_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_test_funding_wallet_date (wallet_id, created_at),
  CONSTRAINT fk_test_funding_actor FOREIGN KEY (actor_id) REFERENCES user_profiles(id),
  CONSTRAINT fk_test_funding_wallet FOREIGN KEY (wallet_id) REFERENCES financial_accounts(id),
  CONSTRAINT ck_test_funding_positive CHECK (amount > 0),
  CONSTRAINT ck_test_funding_balance_nonnegative CHECK (balance_after >= amount),
  CONSTRAINT ck_test_funding_currency CHECK (currency = 'GTQ')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;