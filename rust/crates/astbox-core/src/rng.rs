// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
//! Random source abstraction (support module of the port).
//!
//! The C# core calls Crypto.RandomBytes (OS RNG) at fixed points in the
//! container builders. To prove the P1 DoD — byte-identical output across
//! the C# and Rust implementations — the harness replays the exact entropy
//! extracted from a C#-produced artifact through `ReplayRandom`, so this
//! module exists as the injection seam; public APIs default to `OsRandom`
//! and behave exactly like the C# original.

use crate::errors::E;
use crate::Result;

/// Source of random bytes (mirrors Crypto.RandomBytes call sites).
pub trait RandomSource {
    /// Fill `buf` with random bytes.
    fn fill(&mut self, buf: &mut [u8]) -> Result<()>;

    /// Return `n` fresh random bytes.
    fn bytes(&mut self, n: usize) -> Result<Vec<u8>> {
        let mut v = vec![0u8; n];
        self.fill(&mut v)?;
        Ok(v)
    }
}

/// OS randomness — the default, behaviorally identical to the C# original.
#[derive(Default)]
pub struct OsRandom;

impl RandomSource for OsRandom {
    fn fill(&mut self, buf: &mut [u8]) -> Result<()> {
        getrandom::fill(buf).map_err(|e| crate::err!(E::CryptoFailure, "random failure: {}", e))
    }
}

/// Deterministic replay source: yields a recorded byte stream in order.
/// Used only by the byte-compat harness / tests.
pub struct ReplayRandom {
    stream: Vec<u8>,
    pos: usize,
}

impl ReplayRandom {
    pub fn new(stream: Vec<u8>) -> Self {
        ReplayRandom { stream, pos: 0 }
    }

    pub fn from_chunks(chunks: &[Vec<u8>]) -> Self {
        let mut stream = Vec::new();
        for c in chunks {
            stream.extend_from_slice(c);
        }
        ReplayRandom { stream, pos: 0 }
    }

    pub fn remaining(&self) -> usize {
        self.stream.len() - self.pos
    }
}

impl RandomSource for ReplayRandom {
    fn fill(&mut self, buf: &mut [u8]) -> Result<()> {
        let end = self.pos + buf.len();
        if end > self.stream.len() {
            return Err(crate::err!(
                E::CryptoFailure,
                "replay entropy exhausted (need {} more bytes)",
                end - self.stream.len()
            ));
        }
        buf.copy_from_slice(&self.stream[self.pos..end]);
        self.pos = end;
        Ok(())
    }
}
