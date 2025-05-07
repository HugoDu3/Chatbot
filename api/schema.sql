CREATE TABLE IF NOT EXISTS messages (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id CHAR(36)            NOT NULL,
  role       ENUM('user','assistant','summary') NOT NULL,
  content    TEXT                NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_session ON messages(session_id, id);
