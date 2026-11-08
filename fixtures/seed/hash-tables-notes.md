# Week 2: Hash Tables

These are demo notes for a fictional course, written for TeachBack's seed data.

A hash table stores key-value pairs and finds the value for a key in constant time on average. It keeps an array of buckets and uses a hash function to turn each key into a bucket index. To look up a key, compute its hash, go straight to that bucket, and check the few entries stored there.

Two different keys can land in the same bucket. This is called a collision, and every hash table needs a plan for it. With separate chaining, each bucket holds a short list of entries, and a lookup walks that list. With open addressing, a colliding entry moves to another free slot, found by probing the next slots in a fixed order.

The load factor is the number of entries divided by the number of buckets. As it grows, collisions become more common and lookups slow down. Most implementations resize when the load factor passes a threshold such as 0.75, allocating a larger array and inserting every entry again.

A good hash function spreads keys evenly across the buckets. A poor one sends many keys to the same few buckets, and lookups then degrade toward a linear scan of the whole table.
