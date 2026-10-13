---- MODULE SovereignWalSafety ----
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS MaxSeq, Jobs, Peers, Ops

ASSUME MaxSeq \in Nat /\ MaxSeq >= 1

(* Hashes are abstract sequence tokens here; TLC checks chain linkage, not SHA-256 implementation. *)
Record == [seq : 1..MaxSeq, prevHash : 0..MaxSeq, hash : 1..MaxSeq]
NoRecord == [seq |-> 0, prevHash |-> 0, hash |-> 0]
RecordSet == {NoRecord} \cup Record

VARIABLES head, records, pendingRecord, recordWritten, activeClaims, effects
vars == <<head, records, pendingRecord, recordWritten, activeClaims, effects>>

Init ==
  /\ head = 0
  /\ records = [i \in 1..MaxSeq |-> NoRecord]
  /\ pendingRecord = NoRecord
  /\ recordWritten = FALSE
  /\ activeClaims = {}
  /\ effects = [op \in Ops |-> 0]

PrepareAppend ==
  /\ pendingRecord = NoRecord
  /\ head < MaxSeq
  /\ records[head + 1] = NoRecord
  /\ pendingRecord' = [seq |-> head + 1, prevHash |-> head, hash |-> head + 1]
  /\ recordWritten' = FALSE
  /\ UNCHANGED <<head, records, activeClaims, effects>>

WriteRecord ==
  /\ pendingRecord # NoRecord
  /\ ~recordWritten
  /\ records' = [records EXCEPT ![pendingRecord.seq] = pendingRecord]
  /\ recordWritten' = TRUE
  /\ UNCHANGED <<head, pendingRecord, activeClaims, effects>>

CommitHead ==
  /\ pendingRecord # NoRecord
  /\ recordWritten
  /\ head' = pendingRecord.seq
  /\ pendingRecord' = NoRecord
  /\ recordWritten' = FALSE
  /\ UNCHANGED <<records, activeClaims, effects>>

Crash ==
  /\ pendingRecord # NoRecord
  /\ pendingRecord' = NoRecord
  /\ recordWritten' = FALSE
  /\ UNCHANGED <<head, records, activeClaims, effects>>

Recover ==
  /\ pendingRecord = NoRecord
  /\ head < MaxSeq
  /\ records[head + 1] \in Record
  /\ records[head + 1].seq = head + 1
  /\ records[head + 1].prevHash = head
  /\ records[head + 1].hash = head + 1
  /\ head' = head + 1
  /\ UNCHANGED <<records, pendingRecord, recordWritten, activeClaims, effects>>

Claim(job, peer) ==
  /\ job \in Jobs
  /\ peer \in Peers
  /\ \A other \in Peers : <<job, other>> \notin activeClaims
  /\ activeClaims' = activeClaims \cup {<<job, peer>>}
  /\ UNCHANGED <<head, records, pendingRecord, recordWritten, effects>>

Release(job, peer) ==
  /\ <<job, peer>> \in activeClaims
  /\ activeClaims' = activeClaims \ {<<job, peer>>}
  /\ UNCHANGED <<head, records, pendingRecord, recordWritten, effects>>

ApplyOnce(op) ==
  /\ op \in Ops
  /\ effects[op] = 0
  /\ effects' = [effects EXCEPT ![op] = 1]
  /\ UNCHANGED <<head, records, pendingRecord, recordWritten, activeClaims>>

Next ==
  \/ PrepareAppend
  \/ WriteRecord
  \/ CommitHead
  \/ Crash
  \/ Recover
  \/ \E job \in Jobs, peer \in Peers : Claim(job, peer)
  \/ \E job \in Jobs, peer \in Peers : Release(job, peer)
  \/ \E op \in Ops : ApplyOnce(op)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ head \in 0..MaxSeq
  /\ records \in [1..MaxSeq -> RecordSet]
  /\ pendingRecord \in RecordSet
  /\ recordWritten \in BOOLEAN
  /\ activeClaims \subseteq (Jobs \X Peers)
  /\ effects \in [Ops -> Nat]

HeadConsistent ==
  \A i \in 1..head :
    /\ records[i] \in Record
    /\ records[i].seq = i
    /\ records[i].prevHash = i - 1
    /\ records[i].hash = i

NoDoubleClaim ==
  \A job \in Jobs :
    Cardinality({peer \in Peers : <<job, peer>> \in activeClaims}) <= 1

IdempotencyAtMostOnce ==
  \A op \in Ops : effects[op] <= 1

====
