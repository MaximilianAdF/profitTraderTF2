let list1 = [0, 3, 0, 0];
let list2 = [0, 2, 3, 6];

let result = list1.map((value, index) => value + list2[index]);

console.log(result);