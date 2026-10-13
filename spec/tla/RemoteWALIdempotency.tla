---------------- MODULE RemoteWALIdempotency ----------------
EXTENDS Naturals, FiniteSets, Sequences, TLC

CONSTANTS Ops, Nodes, Keys, MaxSeq
ASSUME /\ Ops # {}
       /\ Nodes # {}
       /\ Keys # {}
       /\ MaxSeq \in Nat \ {0}

VARIABLES wal, claims, dedup, online
vars == <<wal, claims, dedup, online>>

Init ==
  /\ wal = <<>>
  /\ claims = [op \in Ops |-> "NONE"]
  /\ dedup = [key \in Keys |-> 0]
  /\ online = TRUE

Claim(op, node, key) ==
  /\ online
  /\ op \in Ops
  /\ node \in Nodes
  /\ key \in Keys
  /\ claims[op] = "NONE"
  /\ dedup[key] = 0
  /\ Len(wal) < MaxSeq
  /\ LET prev == IF Len(wal) = 0 THEN "GENESIS" ELSE wal[Len(wal)].hash
         rec == [seq |-> Len(wal) + 1,
                 op |-> op,
                 node |-> node,
                 key |-> key,
                 prev |-> prev,
                 hash |-> <<Len(wal) + 1, op, node, key, prev>>]
     IN /\ wal' = Append(wal, rec)
        /\ claims' = [claims EXCEPT ![op] = node]
        /\ dedup' = [dedup EXCEPT ![key] = Len(wal) + 1]
        /\ UNCHANGED online

ReplaySameClaim(op, node, key) ==
  /\ online
  /\ claims[op] = node
  /\ \E i \in 1..Len(wal) :
       /\ dedup[key] = i
       /\ wal[i].op = op
  /\ UNCHANGED vars

Crash ==
  /\ online
  /\ online' = FALSE
  /\ UNCHANGED <<wal, claims, dedup>>

Recover ==
  /\ ~online
  /\ online' = TRUE
  /\ UNCHANGED <<wal, claims, dedup>>

Next ==
  \/ \E op \in Ops, node \in Nodes, key \in Keys : Claim(op, node, key)
  \/ \E op \in Ops, node \in Nodes, key \in Keys : ReplaySameClaim(op, node, key)
  \/ Crash
  \/ Recover

Spec == Init /\ [][Next]_vars

ClaimedOps ==
  {op \in Ops : claims[op] # "NONE"}

NoDuplicateClaims ==
  \A op \in Ops : claims[op] = "NONE" \/ claims[op] \in Nodes

NoDuplicateIdempotencyKeys ==
  \A i, j \in 1..Len(wal) :
    wal[i].key = wal[j].key => i = j

NoDuplicateOpportunityClaims ==
  \A i, j \in 1..Len(wal) :
    wal[i].op = wal[j].op => i = j

DurableClaimMatchesWAL ==
  \A op \in Ops :
    claims[op] # "NONE" =>
      \E i \in 1..Len(wal) :
        wal[i].op = op /\ wal[i].node = claims[op]

SequenceAndHashChain ==
  \A i \in 1..Len(wal) :
    /\ wal[i].seq = i
    /\ wal[i].prev = (IF i = 1 THEN "GENESIS" ELSE wal[i - 1].hash)

Safety ==
  /\ NoDuplicateClaims
  /\ NoDuplicateIdempotencyKeys
  /\ NoDuplicateOpportunityClaims
  /\ DurableClaimMatchesWAL
  /\ SequenceAndHashChain

=============================================================================
