---------------- MODULE RemoteWALIdempotency ----------------
EXTENDS Naturals, FiniteSets, Sequences, TLC

\* Bounded safety model of the WAL record/head protocol.
\* The record write and head commit are separate transitions; a crash between them
\* leaves an immutable record that recovery must discover and commit.
\* Hashes are symbolic links here, not a model of SHA-256 collision resistance.
\* The CAS provider is abstracted; Byzantine consensus is outside this module.

CONSTANTS Ops, Nodes, Keys, MaxSeq
ASSUME /\ Ops # {}
       /\ Nodes # {}
       /\ Keys # {}
       /\ MaxSeq \in Nat \ {0}

VARIABLES records, head, pending, claims, dedup, online
vars == <<records, head, pending, claims, dedup, online>>

RebuildClaims(rs) ==
  [op \in Ops |->
    IF \E i \in 1..Len(rs) : rs[i].op = op
    THEN rs[CHOOSE i \in 1..Len(rs) : rs[i].op = op].node
    ELSE "NONE"]

RebuildDedup(rs) ==
  [key \in Keys |->
    IF \E i \in 1..Len(rs) : rs[i].key = key
    THEN CHOOSE i \in 1..Len(rs) : rs[i].key = key
    ELSE 0]

Init ==
  /\ records = <<>>
  /\ head = 0
  /\ pending = 0
  /\ claims = [op \in Ops |-> "NONE"]
  /\ dedup = [key \in Keys |-> 0]
  /\ online = TRUE

AppendRecord(op, node, key) ==
  /\ online
  /\ pending = 0
  /\ op \in Ops
  /\ node \in Nodes
  /\ key \in Keys
  /\ ~\E i \in 1..Len(records) : records[i].op = op
  /\ ~\E i \in 1..Len(records) : records[i].key = key
  /\ Len(records) < MaxSeq
  /\ LET seq == Len(records) + 1
         prev == IF Len(records) = 0 THEN "GENESIS" ELSE records[Len(records)].hash
         rec == [seq |-> seq,
                 op |-> op,
                 node |-> node,
                 key |-> key,
                 prev |-> prev,
                 hash |-> <<seq, op, node, key, prev>>]
     IN /\ records' = Append(records, rec)
        /\ pending' = seq
        /\ UNCHANGED <<head, claims, dedup, online>>

CommitHead ==
  /\ online
  /\ pending > 0
  /\ pending = Len(records)
  /\ pending = head + 1
  /\ LET rec == records[pending]
     IN /\ head' = pending
        /\ pending' = 0
        /\ claims' = [claims EXCEPT ![rec.op] = rec.node]
        /\ dedup' = [dedup EXCEPT ![rec.key] = pending]
        /\ UNCHANGED <<records, online>>

ReplaySameClaim(op, node, key) ==
  /\ online
  /\ claims[op] = node
  /\ dedup[key] \in 1..head
  /\ records[dedup[key]].op = op
  /\ records[dedup[key]].key = key
  /\ UNCHANGED vars

Crash ==
  /\ online
  /\ online' = FALSE
  /\ pending' = 0
  /\ UNCHANGED <<records, head, claims, dedup>>

Recover ==
  /\ ~online
  /\ online' = TRUE
  /\ head' = Len(records)
  /\ pending' = 0
  /\ claims' = RebuildClaims(records)
  /\ dedup' = RebuildDedup(records)
  /\ UNCHANGED records

Next ==
  \/ \E op \in Ops, node \in Nodes, key \in Keys : AppendRecord(op, node, key)
  \/ CommitHead
  \/ \E op \in Ops, node \in Nodes, key \in Keys : ReplaySameClaim(op, node, key)
  \/ Crash
  \/ Recover

Spec == Init /\ [][Next]_vars

NoDuplicateIdempotencyKeys ==
  \A i, j \in 1..Len(records) :
    records[i].key = records[j].key => i = j

NoDuplicateOpportunityClaims ==
  \A i, j \in 1..Len(records) :
    records[i].op = records[j].op => i = j

DurableClaimMatchesHead ==
  \A op \in Ops :
    claims[op] # "NONE" =>
      \E i \in 1..head :
        records[i].op = op /\ records[i].node = claims[op]

DedupMatchesHead ==
  \A key \in Keys :
    IF dedup[key] = 0
    THEN TRUE
    ELSE dedup[key] \in 1..head /\ records[dedup[key]].key = key

HeadAndPendingConsistent ==
  /\ head \in 0..Len(records)
  /\ (pending = 0 \/ (pending = Len(records) /\ pending = head + 1))

OnlineHeadCaughtUp ==
  online /\ pending = 0 => head = Len(records)

SequenceAndHashChain ==
  \A i \in 1..Len(records) :
    /\ records[i].seq = i
    /\ records[i].prev = (IF i = 1 THEN "GENESIS" ELSE records[i - 1].hash)

Safety ==
  /\ NoDuplicateIdempotencyKeys
  /\ NoDuplicateOpportunityClaims
  /\ DurableClaimMatchesHead
  /\ DedupMatchesHead
  /\ HeadAndPendingConsistent
  /\ OnlineHeadCaughtUp
  /\ SequenceAndHashChain

=============================================================================
