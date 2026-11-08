# Week 4: Sorting Algorithms

These are demo notes for a fictional course, written for TeachBack's seed data. They cover why sorting matters, how to measure an algorithm's cost, and four classic ways to sort a list.

## Why sorting matters

Sorting puts a collection of items into a chosen order, such as numbers from smallest to largest or names from A to Z. It sounds like a small task, but a surprising amount of software depends on it. Once a list is sorted, many other problems become easy. Searching can use binary search instead of checking every item. Duplicates end up next to each other, so finding them takes one pass. The smallest and largest values sit at the two ends. Merging two sorted lists into one sorted list takes a single walk through both.

Sorting is also a good place to learn how to think about algorithms in general. There are many correct ways to sort, and they differ a lot in how much work they do, how much extra memory they need, and how they behave on input that is already nearly in order. Comparing them teaches the habits we will use all term: state the problem precisely, write down an invariant that stays true at every step, and count the work an algorithm does as the input grows.

Throughout these notes we sort an array of n numbers into ascending order. Everything carries over to other kinds of items, as long as we have a rule that says which of two items comes first. That rule is called the comparison, and most of the algorithms here are comparison sorts: the only thing they ever ask about the data is whether one item should come before another.

## Measuring cost with Big-O notation

To compare algorithms we need a way to describe their cost that doesn't depend on a particular laptop or programming language. Big-O notation does this by describing how the number of basic steps grows as the input size n grows, ignoring constant factors and smaller terms.

If an algorithm does at most 3n + 7 steps, we say it runs in O(n) time, or linear time: doubling the input roughly doubles the work. If it does about n²/2 steps, it runs in O(n²) time, or quadratic time: doubling the input roughly quadruples the work. An algorithm that does about n log n steps sits in between, and for large inputs it is far closer to linear than to quadratic. For a million items, n² is a trillion steps, while n log n is about twenty million.

Big-O describes an upper bound, and we usually state it for the worst case, the input that makes the algorithm work hardest. Sometimes the average case or the best case tells a more useful story, and we will say so when it does. Big-O also applies to memory. An in-place sort uses O(1) extra memory beyond the array itself, while a sort that copies the array into a helper array uses O(n) extra memory.

A useful fact to remember: any comparison sort needs about n log n comparisons in the worst case. So an O(n log n) comparison sort is as fast as this kind of algorithm can be, up to constant factors.

## Selection sort

Selection sort is the simplest sort to describe. Find the smallest item in the array and swap it into position 0. Then find the smallest item among the rest and swap it into position 1. Keep going until the whole array is in order.

The invariant is that after k rounds, the first k positions hold the k smallest items, in sorted order, and they never move again. Each round scans every item that isn't placed yet, so the rounds cost n − 1 comparisons, then n − 2, and so on down to 1. That adds up to about n²/2 comparisons, which makes selection sort O(n²) in every case, even when the array starts out sorted. It can't tell that the input is already in order, because it never stops scanning early.

Selection sort does have one useful property: it makes at most n − 1 swaps. When moving an item is much more expensive than comparing two items, for example when each item is a large record, that can matter. In most situations, though, selection sort is a teaching tool rather than a practical choice. It is a good baseline to compare the other algorithms against, because its cost is so easy to work out by hand.

## Insertion sort

Insertion sort builds the sorted result one item at a time, the way many people sort a hand of playing cards. The left part of the array is kept sorted. Each step takes the next item from the unsorted right part and slides it left past every larger item until it reaches its place.

The invariant is that after processing k items, the first k positions are sorted among themselves, although later items may still need to be inserted between them. In the worst case, an array in reverse order, every new item has to slide all the way to the front, which costs about n²/2 comparisons and moves. So insertion sort is O(n²) in the worst case and on average.

Its best case is where it shines. On an array that is already sorted, each item is compared once with its left neighbour and stays put, so the whole sort takes O(n) time. On an array that is nearly sorted, with each item only a few places from where it belongs, insertion sort is also close to linear. It is in-place, needing O(1) extra memory, and it is stable: two items that compare as equal keep their original order.

These properties make insertion sort a common helper inside faster algorithms. Many library sorts switch to insertion sort once a piece of the array gets small, often below a few dozen items, because on tiny inputs its low overhead beats the cleverer methods.

## Divide and conquer

Divide and conquer is a strategy for designing algorithms, not a single algorithm. It has three steps. Divide the problem into smaller subproblems of the same kind. Conquer each subproblem by solving it recursively, until the pieces are small enough to solve directly. Combine the solutions of the subproblems into a solution for the whole problem.

Recursion is the natural way to write a divide and conquer algorithm. The base case handles the smallest pieces, such as an array of length 0 or 1, which is already sorted. The recursive case splits the problem, calls itself on each part, and combines the results. Getting the base case right matters: if a piece can never shrink to the base case, the recursion never ends.

The cost of a divide and conquer algorithm depends on how evenly it divides and how expensive the combine step is. If an algorithm splits a problem of size n into two halves and then does linear work to combine them, the recursion is about log n levels deep, and each level does O(n) work in total. That gives O(n log n) overall, which is the pattern behind both merge sort and quicksort.

Divide and conquer appears far beyond sorting: binary search, fast multiplication of large numbers, finding the closest pair of points, and many algorithms on trees all follow the same three steps. Learning to spot the pattern is more useful than memorizing any one algorithm.

## Merge sort

Merge sort is divide and conquer applied directly. Split the array into two halves. Sort each half recursively. Then merge the two sorted halves into one sorted array.

The merge step is the heart of the algorithm. Keep a position in each half, starting at the front. Compare the two items at those positions, copy the smaller one into the output, and advance in that half. When one half runs out, copy the rest of the other half. Because each comparison places one item, merging two halves with n items in total takes O(n) time.

Splitting in half each time means the recursion is about log n levels deep. Every level merges all n items once, across all its pieces, so merge sort runs in O(n log n) time in the worst case, the average case and the best case alike. Its running time does not depend on the order of the input at all, which makes it predictable.

The price is memory. The usual version merges into a helper array, so it needs O(n) extra space. Merge sort is stable, as long as the merge takes from the left half when two items are equal. That stability, together with its guaranteed O(n log n) time, is why merge sort and its variants are used for sorting records by one field after another, and for sorting data too large to fit in memory, where reading files in order is cheap and jumping around is not.

## Quicksort

Quicksort is another divide and conquer sort, but it does its main work before the recursive calls instead of after them. Choose one item as the pivot. Partition the array so that every item smaller than the pivot comes before it and every larger item comes after it. The pivot is now in its final position. Then sort the part before it and the part after it recursively. No combine step is needed, because the parts are already in the right order relative to each other.

Partitioning walks through the array once, swapping items to the correct side, so it takes O(n) time and needs no helper array. If the pivot lands near the middle each time, the recursion is about log n levels deep and quicksort runs in O(n log n) time. On average, over random orderings of the input, that is what happens, and quicksort's inner loop is so simple that it is often faster in practice than merge sort.

The danger is a bad pivot. If the pivot is always the smallest or largest item, one side of the partition is empty and the other has n − 1 items, so the recursion is n levels deep and the sort takes O(n²) time. Choosing the first item as the pivot triggers exactly this on an array that is already sorted. Common fixes are to choose the pivot at random, or to take the median of the first, middle and last items. Quicksort is in-place apart from the recursion stack, but it is not stable.

## Choosing a pivot well

Because quicksort's speed depends so much on its pivots, it is worth thinking about pivot choice on its own. A perfect pivot would be the median, the item that would sit in the middle of the sorted array, since it splits the array into two equal halves. Finding the exact median every time costs too much, so practical versions settle for a pivot that is good enough most of the time.

A random pivot makes the bad case extremely unlikely for any input, including inputs chosen by someone trying to slow the program down. The expected running time is O(n log n) whatever order the data arrives in. Median-of-three, taking the median of the first, middle and last items, avoids the classic disaster on sorted and reverse-sorted input and costs only a couple of extra comparisons per partition.

Duplicates need care too. If many items equal the pivot, a simple two-way partition can put them all on one side and produce lopsided splits. A three-way partition fixes this by grouping the array into items less than, equal to, and greater than the pivot, and recursing only on the outer two groups. On an array where every item is the same, three-way quicksort finishes in linear time.

Some library sorts protect themselves further by watching the recursion depth. If quicksort goes much deeper than about 2 log n levels, they switch the remaining piece to a sort with a guaranteed O(n log n) worst case.

## Comparing the four sorts

Each of the sorts in these notes makes a different trade-off, and the best choice depends on the data and on what you need from the result.

Selection sort is O(n²) on every input, makes very few swaps, and is mostly useful as a baseline. Insertion sort is also O(n²) in the worst case, but it is O(n) on sorted input, fast on nearly sorted input, in-place and stable, which makes it the standard choice for small pieces inside other sorts. Merge sort guarantees O(n log n) on every input and is stable, but it needs O(n) extra memory. Quicksort runs in O(n log n) time on average with a small constant factor and needs no helper array, but it can degrade to O(n²) with poor pivots and it is not stable.

Stability matters when items have more than one field. Suppose a list of students is already sorted by name, and you sort it again by year. With a stable sort, students in the same year stay in name order. With an unstable sort, that earlier order can be lost.

In practice, standard libraries combine these ideas. A typical library sort uses quicksort or merge sort for large inputs, switches to insertion sort for small pieces, and adds safeguards against the worst case. Knowing the pieces lets you predict how such a hybrid behaves, and pick a different tool when its trade-offs don't fit your problem.

## Practice questions

Try these before the next session, and explain each answer in your own words before checking it.

First, trace insertion sort on the array 5, 2, 4, 6, 1, 3, writing the array after each item is inserted. Count the comparisons. Then do the same for an array that is already sorted, and explain why the counts differ so much.

Second, explain why merge sort's running time stays the same no matter how the input is ordered, while quicksort's running time depends on the pivots it chooses. Your explanation should mention how deep the recursion goes in each case and how much work each level does.

Third, a program sorts a list of two million records by date, and each record is large and expensive to move. Which of the four sorts would you avoid, and which properties would you look for in a better choice?

Fourth, describe an input that makes quicksort with a first-item pivot take quadratic time, and explain how choosing a random pivot changes the picture.

Finally, give an example where a stable sort produces a more useful result than an unstable one, using a list whose items have at least two fields.
