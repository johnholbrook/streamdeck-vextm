let foo = [
    {a:1, b:2},
    {c:3, d:4},
    {e:5, f:6}
];

function remove(arr, key){
    let idx = -1;
    let sKey = JSON.stringify(key)
    // console.log(sKey)
    for (let i=0; i<arr.length; i++){
        // let sCurr = JSON.stringify(arr[i])
        if (JSON.stringify(arr[i]) == sKey){
            idx = i;
            break;
        }
    }
    console.log(idx);
    if (idx >= 0){
        arr.splice(idx, 1);
    }
    return arr;
}

console.log(foo);
foo = remove(foo, {e:5, f:6});
console.log(foo);