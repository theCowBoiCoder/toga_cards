<?php

namespace App\Filament\Pages;

use Filament\Actions\ActionGroup;
use Filament\Forms\Components\DatePicker;
use Filament\Forms\Components\Hidden;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Enums\FiltersLayout;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Support\Collection;

class Inventory extends RecordsPage
{
    use Concerns\ManagesWebsiteListing;

    protected static string|\UnitEnum|null $navigationGroup = 'Shop management';

    protected static string|\BackedEnum|null $navigationIcon = 'heroicon-o-square-3-stack-3d';

    protected ?string $subheading = 'Manage your cards, physical stock and shop availability.';

    protected static ?string $title = 'Inventory & shop';

    protected static ?string $navigationLabel = 'Cards & stock';

    protected static ?int $navigationSort = 10;

    protected string $view = 'filament.pages.inventory';

    public function table(Table $table): Table
    {
        return parent::table($table)
            ->filters([
                SelectFilter::make('club')->label('Team')->placeholder('All teams')
                    ->options(fn (): array => $this->filterOptions('club'))->searchable(),
                SelectFilter::make('variant')->label('Card type')->placeholder('All card types')
                    ->options(fn (): array => $this->filterOptions('variant'))->searchable(),
            ], layout: FiltersLayout::AboveContent)
            ->filtersFormColumns(2)
            ->deferFilters(false);
    }

    protected function filterOptions(string $column): array
    {
        return collect($this->client()->get('/api/inventory')['cards'])
            ->pluck($column)->filter()->unique()->sort()
            ->mapWithKeys(fn (string $value): array => [$value => $value])->all();
    }

    protected function filterRows(Collection $rows, array $filters): Collection
    {
        foreach (['club', 'variant'] as $column) {
            $value = $filters[$column]['value'] ?? null;
            if (filled($value)) {
                $rows = $rows->whereStrict($column, $value);
            }
        }

        return $rows;
    }

    protected function sourceRows(): array
    {
        $shop = $this->client()->get('/api/admin/shop');
        $products = collect($shop['products'])->keyBy('id');
        $targets = collect($shop['stockSync']['targets'])->keyBy('card_id');
        $listings = collect($shop['listings'])->keyBy('card_id');

        return collect($this->client()->get('/api/inventory')['cards'])
            ->map(function (array $card) use ($products, $targets, $listings): array {
                $product = $products[$card['id']] ?? [];
                $allocated = $listings[$card['id']]['quantity'] ?? 0;
                $requested = $targets[$card['id']]['quantity'] ?? $allocated;
                $available = $product['available'] ?? 0;
                $price = $product['price'] ?? null;
                $status = match (true) {
                    $available > 0 => 'Available',
                    ! $price || $requested === 0 => 'Not listed',
                    $card['stock'] === 0 => 'Out of stock',
                    default => 'Unavailable',
                };

                return [...$card, 'shop_card_id' => $card['id'], 'shop_listed' => isset($listings[$card['id']]),
                    'website_sku' => $product['sku'] ?? null, 'price' => $price, 'photo' => $product['photo'] ?? '',
                    'requested' => $requested, 'allocated' => $allocated, 'available' => $available,
                    'website_status' => $status];
            })->all();
    }

    protected function columns(): array
    {
        return [
            TextColumn::make('number')->label('#')->sortable(),
            TextColumn::make('website_sku')->label('SKU')->copyable()->placeholder('Assigned on listing'),
            TextColumn::make('player')->sortable()->wrap()
                ->description(fn (array $record): string => $record['variant'].' · '.$record['condition']),
            TextColumn::make('club')->sortable()->toggleable(isToggledHiddenByDefault: true),
            TextColumn::make('variant')->toggleable(isToggledHiddenByDefault: true),
            TextColumn::make('condition')->toggleable(isToggledHiddenByDefault: true),
            TextColumn::make('stock')->label('Owned')->numeric()->sortable(),
            TextColumn::make('price')->label('Shop price')->money('GBP', divideBy: 100)->placeholder('Set price'),
            TextColumn::make('available')->label('Shop available')->numeric()->sortable(),
            TextColumn::make('website_status')->label('Shop status')->badge()
                ->color(fn (string $state): string => match ($state) {
                    'Available' => 'success',
                    'Needs review', 'Paused' => 'danger',
                    'Checking stock', 'Unavailable' => 'warning',
                    default => 'gray',
                })
                ->wrap(),
            TextColumn::make('requested')->label('Requested for shop')->numeric()->toggleable(isToggledHiddenByDefault: true),
            TextColumn::make('allocated')->label('Reserved for shop')->numeric()->toggleable(isToggledHiddenByDefault: true),
            TextColumn::make('stock_cost')->label('Stock cost')->money('GBP', divideBy: 100)->toggleable(isToggledHiddenByDefault: true),
        ];
    }

    protected function rowActions(): array
    {
        return [
            $this->shopAction(),
            $this->adminAction('createEbay')->label('Create eBay listing')->color('gray')
                ->disabled(fn (array $record): bool => ! $record['shop_listed'] || $record['available'] < 1)
                ->url(fn (array $record): string => EbayCreate::getUrl(['card' => $record['id']])),
            $this->adminAction('updateEbay')->label('Update eBay stock')->color('gray')
                ->requiresConfirmation()
                ->modalDescription(fn (array $record): string => 'Update only this card’s linked eBay listings from its current website availability ('.$record['available'].' copies). If several listings are linked, the first receives the stock and the others are set to zero. Prices stay unchanged. Future stock changes require another update.')
                ->action(fn (array $record) => $this->perform('/api/admin/stock-sync', ['action' => 'sync', 'cardIds' => [$record['id']]], 'Selected eBay stock updated')),
            ActionGroup::make($this->stockActions())->label('Stock')->button()->color('gray'),
        ];
    }

    protected function getHeaderActions(): array
    {
        return [
            $this->adminAction('shopVisibility')->label('Shop visibility')->color('gray')
                ->fillForm(fn (): array => ['enabled' => $this->client()->get('/api/admin/shop')['inStockOnly']])
                ->schema([
                    Toggle::make('enabled')->label('Only show in-stock cards')
                        ->helperText('Show customers only cards currently available to buy on the website.'),
                ])
                ->action(fn (array $data) => $this->perform('/api/admin/shop-visibility', $data, 'Shop visibility saved')),
            $this->adminAction('addCard')->label('Add card')->schema([
            TextInput::make('player')->required()->maxLength(150), TextInput::make('club')->required()->maxLength(150), TextInput::make('number')->required()->maxLength(150),
            TextInput::make('season')->default('2026/27')->required(), TextInput::make('collection')->default('Topps Flagship Premier League')->required(), TextInput::make('variant')->default('Base')->required(),
            Select::make('condition')->options(array_combine(['Near mint', 'Excellent', 'Very good', 'Good', 'Poor'], ['Near mint', 'Excellent', 'Very good', 'Good', 'Poor']))->required(),
            TextInput::make('quantity')->label('Copies received')->integer()->minValue(1)->required(), $this->moneyInput('unitCost', 'Cost per card'), DatePicker::make('date')->default(today())->required(),
        ])->action(fn (array $data) => $this->perform('/api/inventory', [...$data, 'action' => 'card', 'unitCost' => $this->pence($data['unitCost'])], 'Card added')),
            $this->adminAction('export')->label('Export inventory')->url(route('admin.export', ['kind' => 'inventory']))];
    }

    protected function stockActions(): array
    {
        return [
            $this->adminAction('receive')->label('Receive stock')->schema([TextInput::make('quantity')->integer()->minValue(1)->required(), $this->moneyInput('unitCost', 'Cost per card'), DatePicker::make('date')->default(today())->required()])
                ->action(fn (array $data, array $record) => $this->perform('/api/inventory', [...$data, 'action' => 'stock', 'cardId' => $record['id'], 'unitCost' => $this->pence($data['unitCost'])], 'Receipt recorded')),
            $this->adminAction('count')->label('Set counted stock')->fillForm(fn (array $record): array => ['quantity' => $record['stock'], 'expectedStock' => $record['stock'], 'unitCost' => 0, 'date' => today()->toDateString()])
                ->schema([TextInput::make('quantity')->label('Physical copies counted')->integer()->minValue(0)->required(), Hidden::make('expectedStock'), $this->moneyInput('unitCost', 'Cost per additional card'), DatePicker::make('date')->required()])
                ->action(fn (array $data, array $record) => $this->perform('/api/inventory', [...$data, 'action' => 'adjust', 'cardId' => $record['id'], 'unitCost' => $this->pence($data['unitCost'])], 'Count updated')),
            $this->adminAction('sale')->label('Record offline sale')->schema([TextInput::make('quantity')->integer()->minValue(1)->required(), $this->moneyInput('unitPrice', 'Sale price per card'), $this->moneyInput('fees', 'Total fees and postage cost'), Select::make('platform')->options(['In person' => 'In person', 'Other' => 'Other'])->required(), DatePicker::make('date')->default(today())->required()])
                ->action(fn (array $data, array $record) => $this->perform('/api/inventory', [...$data, 'action' => 'sale', 'cardId' => $record['id'], 'unitPrice' => $this->pence($data['unitPrice']), 'fees' => $this->pence($data['fees'])], 'Sale recorded')),
        ];
    }
}
