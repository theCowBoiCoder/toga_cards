<?php

namespace App\Http\Controllers;

use App\Services\InventoryClient;
use Illuminate\Contracts\View\View;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

class CustomerCollectionController extends Controller
{
    public function index(Request $request, InventoryClient $client): View
    {
        $data = $request->validate(['search' => 'nullable|string|max:150', 'collection' => 'nullable|string|max:150', 'view' => 'nullable|in:all,owned,wanted']);
        $products = collect($client->customer('catalogue')['products']);
        $sets = $products->pluck('collection')->unique()->sort();
        $counts = DB::table('customer_collection')->where('user_id', auth('customer')->id())->get()->keyBy('card_id');
        $rows = $products->map(fn (array $card): array => [...$card, 'owned' => $counts[$card['id']]->owned ?? 0, 'wanted' => $counts[$card['id']]->wanted ?? 0])
            ->sort(fn (array $a, array $b): int => strnatcasecmp($a['number'], $b['number']))
            ->filter(fn (array $card): bool => (empty($data['search']) || str_contains(mb_strtolower($card['player'].' '.$card['club'].' '.$card['number'].' '.$card['variant']), mb_strtolower($data['search']))) &&
                (empty($data['collection']) || $card['collection'] === $data['collection']) &&
                (($data['view'] ?? 'all') === 'all' || $card[$data['view']] > 0)
            )->values();
        $page = max(1, (int) $request->query('page', 1));

        return view('customer.collection', ['cards' => new LengthAwarePaginator($rows->forPage($page, 24), $rows->count(), 24, $page, ['path' => $request->url(), 'query' => $request->query()]), 'sets' => $sets]);
    }

    public function save(Request $request, int $cardId, InventoryClient $client): RedirectResponse
    {
        $data = $request->validate(['owned' => 'required|integer|min:0|max:10000', 'wanted' => 'required|integer|min:0|max:10000']);
        abort_unless(collect($client->customer('catalogue')['products'])->contains('id', $cardId), 404);
        DB::table('customer_collection')->updateOrInsert(['user_id' => auth('customer')->id(), 'card_id' => $cardId], [...$data, 'updated_at' => now()]);

        return back()->with('status', 'Collection updated.');
    }
}
